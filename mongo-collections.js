// @ts-check

/** @typedef {import('./typedefs').Authorization} Authorization */
/** @typedef {import('./typedefs').Person} Person */
/** @typedef {import('./typedefs').Setting} Setting */
/**
 * @template T
 * @typedef {import('mongodb').Collection<T>} Collection<T>
 */

const { MongoClient } = require("mongodb");

const mongoclient = MongoClient.connect(process.env.MONGO_URL);

// <~~ MongoDB collections ~~> //
const db = mongoclient.then((cli) => cli.db(process.env.MONGO_DB));

/**
 * Collection of Authorizations. All authorizations expire 6 minutes
 * after their creation time (at).
 *
 * @type {Promise<Collection<Authorization>>}
 */
const authorizationsCol = db.then((db) => db.collection("authorizations"));

/**
 * Collection of Settings. Per location– defines phone numbers thar are allowed
 * to access that location.
 *
 * @type {Promise<Collection<Setting>>}
 */
const settingsCol = db.then((db) => db.collection("settings"));

module.exports = {
  settingsCol,
  authorizationsCol,
};
