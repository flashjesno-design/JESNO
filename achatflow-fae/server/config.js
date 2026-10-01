'use strict';
require('dotenv').config({ quiet: true });
const path = require('path');
const crypto = require('crypto');

const env = process.env;
const NODE_ENV = env.NODE_ENV || 'development';
const ROOT = path.resolve(__dirname, '..');

let JWT_SECRET = env.JWT_SECRET;
if (!JWT_SECRET) {
  if (NODE_ENV === 'production') {
    console.error('ERREUR : la variable JWT_SECRET est obligatoire en production (voir .env.example).');
    process.exit(1);
  }
  JWT_SECRET = 'dev-secret-' + crypto.createHash('sha1').update(ROOT).digest('hex');
  console.warn('[config] JWT_SECRET absent : secret de développement utilisé (ne jamais faire cela en production).');
}

module.exports = {
  ROOT,
  NODE_ENV,
  PORT: parseInt(env.PORT, 10) || 3000,
  APP_NAME: env.APP_NAME || 'AchatFlow',
  BASE_URL: (env.BASE_URL || `http://localhost:${parseInt(env.PORT, 10) || 3000}`).replace(/\/$/, ''),
  DATA_DIR: path.resolve(env.DATA_DIR || path.join(ROOT, 'data')),
  TRUST_PROXY: env.TRUST_PROXY ? parseInt(env.TRUST_PROXY, 10) : (NODE_ENV === 'production' ? 1 : 0),
  JWT_SECRET,
  LICENSE_SECRET: env.LICENSE_SECRET || JWT_SECRET,
  COOKIE_SECURE: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : NODE_ENV === 'production',
  SESSION_HOURS: parseInt(env.SESSION_HOURS, 10) || 12,
  MAX_UPLOAD_MB: parseInt(env.MAX_UPLOAD_MB, 10) || 10,
  SMTP: {
    host: env.SMTP_HOST || '',
    port: parseInt(env.SMTP_PORT, 10) || 587,
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || ''
  },
  WHATSAPP: {
    provider: (env.WHATSAPP_PROVIDER || 'none').toLowerCase(), // none | meta | twilio
    metaToken: env.WHATSAPP_TOKEN || '',
    metaPhoneId: env.WHATSAPP_PHONE_NUMBER_ID || '',
    metaVersion: env.WHATSAPP_API_VERSION || 'v23.0',
    template: env.WHATSAPP_TEMPLATE_NAME || 'fae_notification',
    lang: env.WHATSAPP_TEMPLATE_LANG || 'fr',
    twilioSid: env.TWILIO_ACCOUNT_SID || '',
    twilioToken: env.TWILIO_AUTH_TOKEN || '',
    twilioFrom: env.TWILIO_WHATSAPP_FROM || '', // ex: whatsapp:+14155238886
    twilioContentSid: env.TWILIO_CONTENT_SID || ''
  },
  DEFAULT_COUNTRY_CODE: (env.DEFAULT_COUNTRY_CODE || '225').replace(/\D/g, ''),
  SUPERADMIN_EMAIL: env.SUPERADMIN_EMAIL || '',
  SUPERADMIN_PASSWORD: env.SUPERADMIN_PASSWORD || '',
  SEED_DEMO: env.SEED_DEMO === 'true'
};
