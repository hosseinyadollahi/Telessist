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
app.use(morgan('combined'));
app.use(express.json());

// In-memory store for OTPs (In production, use Redis)
const otpStore = new Map();

// Routes
app.get('/api/auth/status', (req, res) => {
  res.json({ status: 'Auth Service is running', service: 'auth-service' });
});

// Step 1: Request Login Code
app.post('/api/auth/send-code', async (req, res) => {
    const { phone } = req.body;
    
    if (!phone) return res.status(400).json({ error: 'Phone is required' });

    // Generate a 5-digit code (Mock logic)
    const code = '11111'; // For demo purposes, code is always 11111
    
    otpStore.set(phone, code);
    
    console.log(`>>> OTP for ${phone} is: ${code}`);

    // Here you would integrate with an SMS provider (e.g., Twilio, Kavehnegar)
    
    res.json({ success: true, message: 'Code sent successfully' });
});

// Step 2: Verify Code and Get Token
app.post('/api/auth/login', async (req, res) => {
    const { phone, code } = req.body;
    
    const storedCode = otpStore.get(phone);
    
    if (!storedCode || storedCode !== code) {
      return res.status(401).json({ error: 'Invalid code' });
    }

    // Check if user exists, if not create
    try {
      let userResult = await query('SELECT * FROM users WHERE phone = $1', [phone]);
      let user = userResult.rows[0];

      if (!user) {
        const insertResult = await query(
          "INSERT INTO users (phone, avatar) VALUES ($1, $2) RETURNING *", 
          [phone, `https://ui-avatars.com/api/?name=${phone}&background=random`]
        );
        user = insertResult.rows[0];
      }

      // Generate JWT
      const token = jwt.sign({ id: user.id, phone: user.phone }, JWT_SECRET, { expiresIn: '7d' });

      // Clear OTP
      otpStore.delete(phone);

      res.json({ success: true, token, user });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Database error' });
    }
});

app.listen(PORT, () => {
  console.log(`Auth Service running on port ${PORT}`);
});