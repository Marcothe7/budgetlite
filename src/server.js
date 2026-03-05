const express = require('express');
const path    = require('path');
const apiRouter = require('./routes/api');

const app  = express();
const PORT = 3000;

app.use(express.json());
app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Budget Dashboard running at http://localhost:${PORT}`);
});
