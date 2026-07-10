import { createApp } from './app.mjs';

const port = Number(process.env.PORT || 8787);
const serveFrontend = process.env.NODE_ENV === 'production';
createApp({ serveFrontend }).listen(port, '0.0.0.0', () => {
  console.log(`Touchline API listening on http://127.0.0.1:${port}`);
});
