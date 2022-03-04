// This function is used in MongoDB Realm, but generally this is used
// to respond to Twilio's webhook when receiving a text message.

exports = async function ({ query, body }, response) {
  // location id
  const id = query.id;

  // Parse Twilio body as a querystring
  const querystring = require("querystring");
  const twilioMessage = { ...querystring.parse(body.text()) };

  // Twilio message response using TwiML
  const MessagingResponse = require("twilio").twiml.MessagingResponse;

  // Data can be extracted from the request as follows:
  const twiml = new MessagingResponse();

  // Get if this phone number is allowed
  const db = context.services.get("mongodb-atlas").db("door-control");
  const settings = await db.collection("settings").findOne(
    {
      _id: id,
      "allowed_people.phone": twilioMessage.From,
    },
    {
      "allowed_people.$": 1,
    }
  );

  if (settings) {
    const info = settings.allowed_people[0];
    const properCased = id[0].toUppercase + id.substr(1).toLowerCase();
    const accessNum = settings.access_number;
    twiml.message(
      `Hi, ${info.name}! Dial ${accessNum} at ${properCased}'s entrance within the next 5 minutes and I'll let you in :)`
    );

    // Add authorization to the database, or update an existing one.
    await db.collection("authorizations").updateOne(
      {
        person: info,
        for: id,
      },
      {
        $set: { at: new Date() },
      },
      {
        upsert: true,
      }
    );
  } else {
    // Generic "unauthorized" message
    twiml.message("Hi there! I didn't understand that.");
  }

  response.setHeader("Content-Type", "text/xml");
  response.setBody(twiml.toString());
};
