const express  = require('express');
const session  = require('express-session');
const path     = require('path');
const os       = require('os');

const app  = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'espoir-erp-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 8 * 60 * 60 * 1000 }
}));

app.use('/api/auth',      require('./routes/auth'));
app.use('/api/dashboard', require('./routes/dashboard'));

app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
  if (!req.session || !req.session.user) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/', (req, res) => res.redirect('/login'));

app.listen(PORT, '0.0.0.0', () => {
  let ip = 'localhost';
  for (const nets of Object.values(os.networkInterfaces()))
    for (const net of nets)
      if (net.family === 'IPv4' && !net.internal) ip = net.address;

  console.log('\n================================================');
  console.log('   ESPOIR CONSTRUCTION — ERP v2.0');
  console.log('================================================');
  console.log('  Local  : http://localhost:' + PORT);
  console.log('  Reseau : http://' + ip + ':' + PORT);
  console.log('------------------------------------------------');
  console.log('  admin@espoir.bj       / admin123');
  console.log('  directeur@espoir.bj   / dir123');
  console.log('  comptable@espoir.bj   / compta123');
  console.log('  technique@espoir.bj   / tech123');
  console.log('================================================\n');
});
