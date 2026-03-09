const express   = require('express');
const path      = require('path');
const config    = require('./config/app.config');
const apiRouter = require('./routes/api');

const app  = express();
const PORT = config.port;

app.use(express.json());
app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`${config.appName} running at http://localhost:${PORT}`);
});
