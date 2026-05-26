/**
 * _lib.gs — Funciones helper compartidas entre todos los crons/triggers
 * Kaeru Chan ERP — Automation
 */

/** Lee una Script Property; throw si falta */
function _prop(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('Missing Script Property: ' + key);
  return v;
}

var SUPA = {
  url:    _prop('SUPABASE_URL'),
  key:    _prop('SUPABASE_SERVICE_KEY'),
  schema: _prop('SUPABASE_SCHEMA')
};

var TG = {
  token: _prop('TELEGRAM_BOT_TOKEN'),
  chat:  _prop('TELEGRAM_CHAT_ID')
};

/** POST a tabla de Supabase via PostgREST con header de schema */
function supabaseInsert(table, payload) {
  var url = SUPA.url + '/rest/v1/' + table;
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': SUPA.key,
      'Authorization': 'Bearer ' + SUPA.key,
      'Content-Profile': SUPA.schema,   // ← clave: header schema kaeru
      'Prefer': 'return=representation'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 400) {
    throw new Error('Supabase insert failed [' + res.getResponseCode() + ']: ' + res.getContentText());
  }
  return JSON.parse(res.getContentText());
}

/** SELECT a Supabase (PostgREST query) */
function supabaseQuery(table, queryString) {
  var url = SUPA.url + '/rest/v1/' + table + (queryString || '');
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'apikey': SUPA.key,
      'Authorization': 'Bearer ' + SUPA.key,
      'Accept-Profile': SUPA.schema
    },
    muteHttpExceptions: true
  });
  return JSON.parse(res.getContentText());
}

/** Invocar Edge Function */
function supabaseEdgeFunction(name, body) {
  var url = SUPA.url + '/functions/v1/' + name;
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + SUPA.key
    },
    payload: JSON.stringify(body || {}),
    muteHttpExceptions: true
  });
  return { code: res.getResponseCode(), body: res.getContentText() };
}

/** Enviar mensaje al grupo Telegram */
function telegramSend(text, parseMode) {
  var url = 'https://api.telegram.org/bot' + TG.token + '/sendMessage';
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: TG.chat,
      text: text,
      parse_mode: parseMode || 'Markdown'
    }),
    muteHttpExceptions: true
  });
}
