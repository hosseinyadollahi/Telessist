import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { query } from '../shared/db.js';

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-prod';

app.use(helmet());
app.use(cors());
app.use(express.json());

// --- ADVANCED DEBUG LOGGER ---
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const method = req.method;
  const url = req.url;
  
  // Console colors
  const reset = "\x1b[0m";
  const cyan = "\x1b[36m";
  const green = "\x1b[32m";
  const yellow = "\x1b[33m";

  console.log(`${cyan}[AUTH-REQ] ${timestamp} | ${method} ${url}${reset}`);
  
  if (Object.keys(req.body).length > 0) {
    console.log(`${yellow}[AUTH-BODY]${reset}`, JSON.stringify(req.body, null, 2));
  }
  
  if (Object.keys(req.query).length > 0) {
    console.log(`${yellow}[AUTH-QUERY]${reset}`, JSON.stringify(req.query, null, 2));
  }

  // Capture response
  const originalSend = res.send;
  res.send = function (body) {
    console.log(`${green}[AUTH-RES] ${res.statusCode}${reset} sent to ${url}`);
    return originalSend.apply(this, arguments);
  };

  next();
});

// In-memory store for OTPs (In production, use Redis)
const otpStore = new Map();

app.get('/api/auth/status', (req, res) => {
  res.json({ status: 'Auth Service is running', service: 'auth-service', time: new Date() });
});

// Step 1: Request Login Code
app.post('/api/auth/send-code', async (req, res) => {
    console.log("Processing /send-code request...");
    const { phone } = req.body;
    
    if (!phone) {
      console.warn('❌ Send Code Failed: Missing phone number');
      return res.status(400).json({ error: 'Phone is required' });
    }

    const code = '11111'; 
    otpStore.set(phone, code);
    
    console.log(`✅ OTP Generated for ${phone}: ${code}`);
    res.json({ success: true, message: 'Code sent successfully' });
});

// Step 2: Verify Code and Get Token
app.post('/api/auth/login', async (req, res) => {
    console.log("Processing /login request...");
    const { phone, code } = req.body;
    
    const storedCode = otpStore.get(phone);
    
    if (!storedCode) {
        console.warn(`❌ Login Failed: No OTP found for ${phone}`);
        return res.status(401).json({ error: 'Code expired or not requested' });
    }

    if (storedCode !== code) {
        console.warn(`❌ Login Failed: Invalid code. Expected ${storedCode}, got ${code}`);
        return res.status(401).json({ error: 'Invalid code' });
    }

    try {
      console.log(`🔍 Checking DB for user ${phone}...`);
      let userResult = await query('SELECT * FROM users WHERE phone = $1', [phone]);
      let user = userResult.rows[0];

      if (!user) {
        console.log(`👤 User not found. Creating new user for ${phone}...`);
        const insertResult = await query(
          "INSERT INTO users (phone, avatar) VALUES ($1, $2) RETURNING *", 
          [phone, `https://ui-avatars.com/api/?name=${phone}&background=random`]
        );
        user = insertResult.rows[0];
        console.log(`✨ New user created: ID ${user.id}`);
      } else {
        console.log(`✅ User found: ID ${user.id}`);
      }

      const token = jwt.sign({ id: user.id, phone: user.phone }, JWT_SECRET, { expiresIn: '7d' });
      otpStore.delete(phone);
      console.log(`🔑 Token generated for user ${user.id}`);

      res.json({ success: true, token, user });
    } catch (err) {
      console.error('🔥 Database error during login:', err);
      res.status(500).json({ error: 'Database error' });
    }
});

app.listen(PORT, () => {
  console.log(`\x1b[35m[AUTH-SERVICE]\x1b[0m Running on port ${PORT}`);
});