import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import { query } from '../shared/db.js';

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-prod';

app.use(helmet());
app.use(cors());
app.use(morgan('combined')); // Standard HTTP logs
app.use(express.json());

// Custom Logger Middleware for Request Body
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  // Don't log full code/password/token in production, but helpful for debug now
  console.log(`[AUTH-API] ${timestamp} | ${req.method} ${req.url}`);
  if (Object.keys(req.body).length > 0) {
    console.log(`[AUTH-API] Body:`, JSON.stringify(req.body));
  }
  next();
});

// In-memory store for OTPs (In production, use Redis)
const otpStore = new Map();

// Routes
app.get('/api/auth/status', (req, res) => {
  res.json({ status: 'Auth Service is running', service: 'auth-service' });
});

// Step 1: Request Login Code
app.post('/api/auth/send-code', async (req, res) => {
    const { phone } = req.body;
    
    if (!phone) {
      console.warn('[AUTH-FLOW] Send Code Failed: Missing phone number');
      return res.status(400).json({ error: 'Phone is required' });
    }

    // Generate a 5-digit code (Mock logic)
    const code = '11111'; // For demo purposes, code is always 11111
    
    otpStore.set(phone, code);
    
    console.log(`[AUTH-FLOW] OTP Generated for ${phone}: ${code}`);
    console.log(`[AUTH-FLOW] OTP Store Size: ${otpStore.size}`);

    // Here you would integrate with an SMS provider (e.g., Twilio, Kavehnegar)
    
    res.json({ success: true, message: 'Code sent successfully' });
});

// Step 2: Verify Code and Get Token
app.post('/api/auth/login', async (req, res) => {
    const { phone, code } = req.body;
    
    console.log(`[AUTH-FLOW] Login attempt for ${phone} with code ${code}`);

    const storedCode = otpStore.get(phone);
    
    if (!storedCode) {
        console.warn(`[AUTH-FLOW] Login Failed: No OTP found for ${phone}`);
        return res.status(401).json({ error: 'Code expired or not requested' });
    }

    if (storedCode !== code) {
        console.warn(`[AUTH-FLOW] Login Failed: Invalid code. Expected ${storedCode}, got ${code}`);
        return res.status(401).json({ error: 'Invalid code' });
    }

    // Check if user exists, if not create
    try {
      console.log(`[AUTH-FLOW] Checking DB for user ${phone}...`);
      let userResult = await query('SELECT * FROM users WHERE phone = $1', [phone]);
      let user = userResult.rows[0];

      if (!user) {
        console.log(`[AUTH-FLOW] User not found. Creating new user for ${phone}...`);
        const insertResult = await query(
          "INSERT INTO users (phone, avatar) VALUES ($1, $2) RETURNING *", 
          [phone, `https://ui-avatars.com/api/?name=${phone}&background=random`]
        );
        user = insertResult.rows[0];
        console.log(`[AUTH-FLOW] New user created: ID ${user.id}`);
      } else {
        console.log(`[AUTH-FLOW] User found: ID ${user.id}`);
      }

      // Generate JWT
      const token = jwt.sign({ id: user.id, phone: user.phone }, JWT_SECRET, { expiresIn: '7d' });

      // Clear OTP
      otpStore.delete(phone);
      console.log(`[AUTH-FLOW] OTP cleared for ${phone}. Token generated.`);

      res.json({ success: true, token, user });
    } catch (err) {
      console.error('[AUTH-ERROR] Database error during login:', err);
      res.status(500).json({ error: 'Database error' });
    }
});

app.listen(PORT, () => {
  console.log(`==========================================`);
  console.log(`[AUTH-SERVICE] Running on port ${PORT}`);
  console.log(`==========================================`);
});