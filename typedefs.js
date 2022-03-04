import { ObjectId } from "mongodb";

/**
 * @typedef {Object} Authorization
 * @property {ObjectId} _id - The ObjectId that uniquely identifies this Authorization.
 * @property {Person} person - The person who requested this authorization
 * @property {Date} at - The creation time
 * @property {string} for - The location this authorization was created for
 */

/**
 * @typedef {Object} Setting
 * @property {string} _id - The ID of this location
 * @property {Array<Person>} allowed_people - The people allowed to request access.
 * @property {Array<string>} notify_numbers - Numbers to notify whenever access is granted
 */

/**
 * The above ^^ objects store People, which are just a pair of name and number.
 *
 * @typedef {Object} Person
 * @property {string} name - The person's name
 * @property {string} phone - The person's phone number.
 */
