const express = require('express');
const cors = require('cors');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 1. SECURITY HEADERS (Cross-Site Scripting & Sniffing protection)
app.use(helmet());

// 2. RESTRICTED CORS (Sirf allowed domains ko request bhejne ki permission)
const allowedOrigins = [
  'https://my-media-s4g1.onrender.com',
  'http://localhost:3000',
  'http://127.0.0.1:5500'
];

app.use(cors({
  origin: function (origin, callback) {
    // Mobile apps ya server-to-server requests mein origin null ho sakta hai
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS Policy: Origin not permitted'));
    }
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 3. RATE LIMITING (Spam aur Denial-of-Service attacks se bachne ke liye)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minutes
  max: 100, // Max 100 requests per IP
  message: { error: "Bohot saare requests bheje gaye hain. Kripya 15 minute baad try karein." }
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15, // Max 15 uploads per IP per 15 mins
  message: { error: "Upload limit exceed ho gayi hai. 15 minute baad dubara try karein." }
});

app.use('/api/', generalLimiter);

// 4. ENVIRONMENT VARIABLES VALIDATION
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const BUCKET_NAME = process.env.BUCKET_NAME || "media-files";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("FATAL ERROR: Supabase environment variables configured nahi hain!");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 5. FILE FILTER & VALIDATION (Malicious files `.exe`, `.html`, `.php` ko block karne ke liye)
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
    'application/pdf'
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid File Type! Sirf Images, Videos aur PDFs allowed hain.'), false);
  }
};

// Multer RAM Protection Limit (Server crash hone se bachane ke liye)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // Limit 25MB per file
    files: 5                   // Max 5 files per request batch
  },
  fileFilter: fileFilter
});

// Root Health Check Route
app.get('/', (req, res) => {
  res.status(200).send('Media Secure Backend API Running!');
});

// 6. UPLOAD API (Secure Upload)
app.post('/api/upload', uploadLimiter, (req, res) => {
  upload.array('files', 5)(req, res, async (err) => {
    // Multer / File Validation Errors handling
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "Koi file select nahi ki gayi hai." });
    }

    try {
      const uploadPromises = req.files.map(async (file) => {
        // Sanitize File Name (Special characters clean karna)
        const cleanFileName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
        const fileName = `${Date.now()}_${Math.floor(Math.random() * 1000)}_${cleanFileName}`;

        const { data, error } = await supabase.storage
          .from(BUCKET_NAME)
          .upload(fileName, file.buffer, {
            contentType: file.mimetype,
            upsert: false
          });

        if (error) throw error;

        const { data: urlData } = supabase.storage
          .from(BUCKET_NAME)
          .getPublicUrl(fileName);

        return {
          fileName: fileName,
          url: urlData.publicUrl,
          mimeType: file.mimetype
        };
      });

      const results = await Promise.all(uploadPromises);
      res.status(200).json({ success: true, files: results });

    } catch (error) {
      console.error("Supabase Upload Error:", error.message);
      // Client ko raw internal server errors na bhejna (Data Leak Security)
      res.status(500).json({ error: "File upload karne me internal error aaya." });
    }
  });
});

// 7. FEED API (Secure Fetch)
app.get('/api/feed', async (req, res) => {
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .list('', {
        limit: 100,
        sortBy: { column: 'created_at', order: 'desc' }
      });

    if (error) throw error;

    const feedItems = data.map(item => {
      const { data: urlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(item.name);

      return {
        id: item.id,
        name: item.name,
        url: urlData.publicUrl,
        created_at: item.created_at
      };
    });

    res.status(200).json({ success: true, feed: feedItems });

  } catch (error) {
    console.error("Feed Fetch Error:", error.message);
    res.status(500).json({ error: "Feed fetch nahi ho paaya." });
  }
});

// Error handling fallback middleware
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err.stack);
  res.status(500).json({ error: "Server me error aaya hai." });
});

app.listen(PORT, () => {
  console.log(`Server running securely on port ${PORT}`);
});
