import { createApp } from './app.js';
import { loadBuildInfo } from './config.js';

const port = Number(process.env.PORT) || 3000;
const app = createApp(loadBuildInfo(process.env));

app.listen(port, () => {
  console.log(`server listening on :${port}`);
});
