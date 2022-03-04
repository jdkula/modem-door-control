//@ts-check
/**
 * main.js
 * ========
 * DailerControl is a small lil' utility that allows text-based access
 * to buildings by linking in with the buzz-in system through a USB
 * dial-up modem.
 */

//// <== Environment Setup ==> ////

// <~~ Environment setup & constants ~~> //
require("dotenv").config();

const kLocationId = process.env.SETTING_ID;
const kAccountSid = process.env.TWILIO_SID;
const kAuthToken = process.env.TWILIO_AUTH;
const kTwilioPhone = process.env.TWILIO_PHONE;

// <~~ Imports ~~> //
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const { Logger } = require("tslog");
const { MongoClient } = require("mongodb");
const twilio = require("twilio");

// <~~ Type Imports ~~> //
/**
 * @template T
 * @typedef {import('mongodb').Collection<T>} Collection<T>
 */

/**
 * @typedef {import('mongodb').ObjectId} ObjectId
 */

/**
 * @template T
 * @typedef {import('mongodb').ChangeStreamDocument<T>} ChangeStreamDocument<T>
 */

// <~~ Remote service connections ~~> //
const twilioClient = twilio(kAccountSid, kAuthToken);
const mongoclient = MongoClient.connect(process.env.MONGO_URL);

// <~~ MongoDB collections ~~> //
const db = mongoclient.then((cli) => cli.db(process.env.MONGO_DB));

/**
 * Collection of Authorizations. All authorizations expire 6 minutes
 * after their creation time (at).
 *
 * @typedef {Object} Authorization
 * @property {ObjectId} _id - The ObjectId that uniquely identifies this Authorization.
 * @property {Person} person - The person who requested this authorization
 * @property {Date} at - The creation time
 * @property {string} for - The location this authorization was created for
 */
/** @type {Promise<Collection<Authorization>>} */
const authorizationsCol = db.then((db) => db.collection("authorizations"));

/**
 * Collection of Settings. Per location– defines phone numbers thar are allowed
 * to access that location.
 *
 * @typedef {Object} Setting
 * @property {string} _id - The ID of this location
 * @property {Array<Person>} allowed_people - The people allowed to request access.
 * @property {Array<string>} notify_numbers - Numbers to notify whenever access is granted
 */
/** @type {Promise<Collection<Setting>>} */
const settingsCol = db.then((db) => db.collection("settings"));

/**
 * The above ^^ objects store People, which are just a pair of name and number.
 *
 * @typedef {Object} Person
 * @property {string} name - The person's name
 * @property {string} phone - The person's phone number.
 */

// <~~ Logging setup ~~> //
const ttyLog = new Logger({
  name: "TTY",
  displayFilePath: "hidden",
  displayFunctionName: false,
});
const mongoChangeLog = new Logger({ name: "MongoDB Change" });
const controlLog = new Logger({ name: "Control" });
controlLog.info(
  `Hello! Door control for location ${kLocationId} starting up...`
);

// <~~ TTY (Serial) setup ~~> //
const port = new SerialPort({
  path: process.env.TTY_PATH,
  baudRate: 115200, // My modem uses 115200 8N1 for serial communication.
  dataBits: 8,
  parity: "none",
  stopBits: 1,
  autoOpen: true,
});
const parser = port.pipe(new ReadlineParser());

// <~~ Globals ~~> //
/** Locally stores authorizations so we can notify when they expire. */
const localAuthMap = new Map();

//// <== Helper Classes & Functions ==> ////

/**
 * EventWaiter
 *
 * Allows async functions to block until the EventWaiter is triggered.
 */
class EventWaiter {
  constructor() {
    this.resolvers = [];
  }

  // Resolves when trigger() is called elsewhere
  async wait() {
    return await new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  // Resolves all current wait()-ers
  trigger() {
    this.resolvers.forEach((resolve) => resolve());
    this.resolvers = [];
  }
}

/**
 * Returns all the authorizations for this location,
 * or null if none exist.
 *
 * @returns {Promise<null | Authorization[]>} Authorizations
 */
async function getAuthorizations() {
  controlLog.silly(`Retrieving authorizations for location ${kLocationId}`);
  const collection = await authorizationsCol;
  const arr = await collection.find({ for: process.env.SETTING_ID }).toArray();
  controlLog.silly(`Retrieved ${arr.length} authorization(s)`);
  return arr.length === 0 ? null : arr;
}

/**
 * Removes all of the given authorizations from the database
 * without notifying anyone.
 *
 * @param {Array<Authorization>} authorizations
 */
async function expireAuthorizations(authorizations) {
  controlLog.silly(`Expiring ${authorizations.length} authorizations...`);
  const collection = await authorizationsCol;
  authorizations.forEach((auth) => localAuthMap.delete(auth._id.toHexString()));
  collection.deleteMany({
    _id: { $in: authorizations.map((au) => au._id) },
  });

  controlLog.info("Authorization tickets successfully expired");
}

/**
 * Returns the settings information for this location.
 *
 * @returns {Promise<null | Setting>} Settings
 */
async function getSettings() {
  controlLog.silly(`Retrieving settings for location ${kLocationId}`);
  const collection = await settingsCol;
  const out = await collection.findOne({ _id: kLocationId });
  controlLog.silly("Retrieved settings", out);
  return out;
}

const okWaiter = new EventWaiter();

//// <== Primary Functionality ==> ////

/**
 * Triggered when the serial port opens
 */
function onOpen() {
  controlLog.debug("Triggering control sequence");
  port.write("+++\r\n"); // AT escape sequence (-> command mode)
  port.write("ATH0\r\n"); // Go on-hook if we were off-hook before
  port.write("ATX0\r\n"); // Disable checking for a dial tone (we're exploiting this to use dialing to input 9)
  controlLog.info("Ready.");
}

/**
 * Triggered when a new line of data has been received from the modem.
 */
function onData(data) {
  data = data.trim();
  ttyLog.debug(data);
  if (data === "RING") {
    // Incoming call
    onRing();
  } else if (data === "OK") {
    // Acknowledged previous command
    onOk();
  }
}

/** Triggers any promises waiting on the modem to acknowledge a previous command */
function onOk() {
  controlLog.silly("Got 'OK' from modem");
  okWaiter.trigger();
}

/** Allows authorized users in if they exist. */
async function onRing() {
  controlLog.debug("Ring Received.");
  const authorizations = await getAuthorizations();

  if (!authorizations) {
    controlLog.info("No authorizations found: ignoring ring.");
    return;
  } // else let them in!

  const settings = await getSettings();
  const userNames = authorizations.map((auth) => auth.person.name);

  // Promises not awaited on purpose-- should happen asynchronously.
  notify(authorizations, settings); // Notify people that we're letting them in
  expireAuthorizations(authorizations); // Expire authorizations (they're one-time use!)

  controlLog.info(
    `Found authorizations for ${userNames.join(",")}. Triggering door.`
  );
  controlLog.debug("Dialing 9 to trigger door");
  // "Dials" 9, which A) picks up the phone (currently ringing) and B) presses the 9 button.
  // Command anatomy: ATD (Dial) T (tone) 9 (number 9) , (wait 2s) ; (remain in command mode)
  port.write("ATDT9,;\r\n");

  // Wait for modem to finish (i.e. until we receive OK)
  await okWaiter.wait();

  // Go on-hook
  controlLog.debug("Hanging up");
  port.write("ATH\r\n");
}

/**
 * Wrapper that runs admin and user notifications simultaneously and
 * resolves when all messages have been sent out.
 *
 * @param {Array<Authorization>} authorizations
 * @param {Setting} settings
 */
async function notify(authorizations, settings) {
  await Promise.all([
    notifyAdmins(authorizations, settings),
    ...authorizations.map(notifyOne),
  ]);
}

/**
 * Notifies a user that they were just let in!
 * @param {Authorization} authorization
 */
async function notifyOne(authorization) {
  controlLog.silly(`Sending user notification to ${authorization.person.name}`);
  await twilioClient.messages.create({
    body: "Just let you in!",
    from: kTwilioPhone,
    to: authorization.person.phone,
  });
  controlLog.silly(
    `Finished sending user notification to ${authorization.person.name}`
  );
}

/**
 * Notifies the admins that a group of people were just let in.
 *
 * @param {Array<Authorization>} authorizations
 * @param {Setting} settings
 */
async function notifyAdmins(authorizations, settings) {
  controlLog.silly(`Sending admin notifications`);

  const userNamesJoined = authorizations
    .map((auth) => auth.person.name)
    .join(",");

  await Promise.all(
    settings.notify_numbers.map((number) =>
      twilioClient.messages.create({
        body: `I just let the following people in: ${userNamesJoined}`,
        from: kTwilioPhone,
        to: number,
      })
    )
  );

  controlLog.silly(`Finished sending admin notifications`);
}

/**
 * Handles streaming changes in the database, which we use
 * to notify users when their authorizations expired unused.
 *
 * @param {ChangeStreamDocument<Authorization>} next
 */
async function onMongoChange(next) {
  mongoChangeLog.silly("Got MongoDB ChangeEvent");

  // New authorization created
  if (next.operationType === "insert") {
    mongoChangeLog.silly(
      `Stored new authorization for ${next.fullDocument.person.name} in local map`
    );
    localAuthMap.set(
      next.fullDocument._id.toHexString(),
      next.fullDocument.person
    );

    // Authorization was expired or was deleted
  } else if (next.operationType === "delete") {
    mongoChangeLog.silly("Got authorization deletion...");
    // Person won't be present here if the token was used
    const person = localAuthMap.get(next.documentKey._id.toHexString());
    // Remove from the local map
    localAuthMap.delete(next.documentKey._id.toHexString());

    // If the person's token expired unused
    if (person) {
      mongoChangeLog.debug(`Authorization for ${person.name} expired`);
      mongoChangeLog.silly(
        `Sending authorization expiration message to ${person.name}`
      );
      await twilioClient.messages.create({
        body: "Hmm, I didn't see you arrive within 5 minutes! Text again if you need to get in",
        to: person.phone,
        from: kTwilioPhone,
      });
      mongoChangeLog.silly(
        `Sent authorization expiration message to ${person.name}`
      );
    }
  }
}

//// <== Listener Setup ==> ////

// <~~ Serial events ~~> //
port.on("open", onOpen);
parser.on("data", onData);

// <~~ Mongo change stream setup ~~> //
authorizationsCol
  .then((col) =>
    col.watch([], {
      fullDocument: "updateLookup",
    })
  )
  .then((watcher) => watcher.on("change", onMongoChange));

// <~~ Get initial authorizations ~~> //
getAuthorizations().then(
  (authorizations) =>
    authorizations &&
    authorizations.forEach((authorization) =>
      localAuthMap.set(authorization._id.toHexString(), authorization.person)
    )
);
