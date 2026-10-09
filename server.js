import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { google } from 'googleapis';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';
const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET'];
const missing = required.filter((k) => !process.env[k] || process.env[k].startsWith('cole_') || process.env[k].startsWith('troque_'));
if (missing.length) {
  console.error(`Configure estas variáveis no arquivo .env: ${missing.join(', ')}`);
  process.exit(1);
}
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/google/callback`;
const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose'
];

function oauthClient() {
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, REDIRECT_URI);
}
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' } }));
app.use(express.json({ limit: '30kb' }));
app.use(session({
  name: 'eudora.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 8 * 60 * 60 * 1000 }
}));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (!req.session.tokens) return res.status(401).json({ error: 'Conecte sua conta Google para continuar.' });
  next();
}
function gmailFor(req) {
  const auth = oauthClient();
  auth.setCredentials(req.session.tokens);
  auth.on('tokens', (tokens) => {
    req.session.tokens = { ...req.session.tokens, ...tokens };
  });
  return google.gmail({ version: 'v1', auth });
}
function decodeBase64Url(value = '') {
  try { return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
  catch { return ''; }
}
function headerValue(headers = [], name) {
  return headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
}
function extractBody(payload) {
  if (!payload) return '';
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  const parts = payload.parts || [];
  for (const wanted of ['text/plain', 'text/html']) {
    const found = parts.find(p => p.mimeType === wanted && p.body?.data);
    if (found) return decodeBase64Url(found.body.data).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    for (const part of parts) {
      const nested = extractBodyByMime(part, wanted);
      if (nested) return nested;
    }
  }
  return '';
}
function extractBodyByMime(part, wanted) {
  if (part.mimeType === wanted && part.body?.data) return decodeBase64Url(part.body.data).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  for (const child of part.parts || []) { const text = extractBodyByMime(child, wanted); if (text) return text; }
  return '';
}
function toMessage(message) {
  const headers = message.payload?.headers || [];
  return {
    id: message.id,
    threadId: message.threadId,
    from: headerValue(headers, 'From'),
    to: headerValue(headers, 'To'),
    subject: headerValue(headers, 'Subject') || '(sem assunto)',
    date: headerValue(headers, 'Date'),
    snippet: message.snippet || '',
    unread: (message.labelIds || []).includes('UNREAD'),
    body: extractBody(message.payload)
  };
}
function safeError(err) {
  console.error('Gmail API error:', err?.response?.data?.error?.message || err.message);
  const status = Number(err?.response?.status) || 500;
  if (status === 401 || status === 403) return { status, message: 'O Google recusou a solicitação. Verifique as permissões OAuth e reconecte a conta.' };
  if (status === 404) return { status, message: 'Mensagem não encontrada.' };
  if (status === 429) return { status, message: 'Limite temporário da API atingido. Tente novamente em instantes.' };
  return { status: status >= 400 && status < 600 ? status : 500, message: 'Não foi possível concluir a operação no Gmail.' };
}

app.get('/auth/google', (req, res) => {
  const state = crypto.randomBytes(24).toString('hex');
  req.session.oauthState = state;
  const url = oauthClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES, state });
  res.redirect(url);
});
app.get('/auth/google/callback', async (req, res) => {
  try {
    if (!req.query.state || req.query.state !== req.session.oauthState) return res.status(400).send('Estado OAuth inválido. Volte à EUDORA e tente conectar novamente.');
    delete req.session.oauthState;
    if (req.query.error) return res.redirect('/?auth=cancelled');
    if (typeof req.query.code !== 'string') return res.status(400).send('Código OAuth ausente.');
    const { tokens } = await oauthClient().getToken(req.query.code);
    req.session.tokens = tokens;
    req.session.save(() => res.redirect('/?auth=success'));
  } catch (err) {
    console.error('Falha OAuth:', err.message);
    res.redirect('/?auth=error');
  }
});
app.get('/api/status', async (req, res) => {
  if (!req.session.tokens) return res.json({ connected: false });
  try {
    const auth = oauthClient(); auth.setCredentials(req.session.tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth });
    const { data } = await oauth2.userinfo.get();
    res.json({ connected: true, email: data.email || '', name: data.name || '' });
  } catch {
    req.session.tokens = null;
    res.json({ connected: false });
  }
});
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => { res.clearCookie('eudora.sid'); res.json({ ok: true }); });
});
app.get('/api/messages', requireAuth, async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 300) : 'in:inbox';
    const maxResults = Math.max(1, Math.min(25, Number(req.query.maxResults) || 10));
    const gmail = gmailFor(req);
    const listed = await gmail.users.messages.list({ userId: 'me', q, maxResults });
    const messages = await Promise.all((listed.data.messages || []).map(async (m) => {
      const r = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
      return toMessage(r.data);
    }));
    res.json({ messages, resultSizeEstimate: listed.data.resultSizeEstimate || messages.length });
  } catch (err) { const e = safeError(err); res.status(e.status).json({ error: e.message }); }
});
app.get('/api/messages/:id', requireAuth, async (req, res) => {
  try {
    const { data } = await gmailFor(req).users.messages.get({ userId: 'me', id: req.params.id, format: 'full' });
    res.json({ message: toMessage(data) });
  } catch (err) { const e = safeError(err); res.status(e.status).json({ error: e.message }); }
});
app.get('/api/profile', requireAuth, async (req, res) => {
  try {
    const { data } = await gmailFor(req).users.getProfile({ userId: 'me' });
    res.json({ email: data.emailAddress, messagesTotal: data.messagesTotal, threadsTotal: data.threadsTotal, historyId: data.historyId });
  } catch (err) { const e = safeError(err); res.status(e.status).json({ error: e.message }); }
});
app.post('/api/drafts', requireAuth, async (req, res) => {
  try {
    const { to, subject, body } = req.body || {};
    if (typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) return res.status(400).json({ error: 'Informe um endereço de e-mail válido no campo Para.' });
    if (typeof subject !== 'string' || subject.length > 998) return res.status(400).json({ error: 'Assunto inválido (máximo de 998 caracteres).' });
    if (typeof body !== 'string' || !body.trim() || body.length > 100000) return res.status(400).json({ error: 'O corpo do e-mail é obrigatório e deve ter até 100.000 caracteres.' });
    const lines = [`To: ${to.trim()}`, `Subject: ${subject.replace(/[\r\n]/g, ' ')}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(body, 'utf8').toString('base64')];
    const raw = Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
    const { data } = await gmailFor(req).users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });
    res.status(201).json({ ok: true, draftId: data.id, message: 'Rascunho criado na sua conta Gmail.' });
  } catch (err) { const e = safeError(err); res.status(e.status).json({ error: e.message }); }
});
app.get('/api/drafts', requireAuth, async (req, res) => {
  try {
    const { data } = await gmailFor(req).users.drafts.list({ userId: 'me', maxResults: 10 });
    res.json({ drafts: data.drafts || [] });
  } catch (err) { const e = safeError(err); res.status(e.status).json({ error: e.message }); }
});
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`EUDORA disponível em http://localhost:${PORT}`));
