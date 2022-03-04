# Modem Door Control

This small application controls a serial fax/dial-up modem to allow
text-based building access using phone-based buzz-in systems.
Tricks it into "dialing" a number when it's receiving a call,
so we don't get any ugly fax or data noises. As long as it's compatible
with AT commands this should work!

Environment variables:

```yaml
MONGO_URL: MongoDB connection string
MONGO_DB: MongoDB database to use
LOCATION_ID: The location settings stored in the database to use
DIAL_SEQUENCE: The sequence used to unlock the door. Use , to add a 2-second pause.
TWILIO_SID: Twilio Auth ID
TWILIO_AUTH: Twilio Auth Secret
TWILIO_PHONE: The phone number to send text messages from
MIN_LOG_LEVEL: The minimum logging level. One of "silly", "trace", "debug", "info", "warn", "error", or "fatal". Defaults to "debug".
```

Created mostly for education purposes. Please be careful with
building access!
