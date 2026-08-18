const express = require('express');
const cors = require('cors');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 1. SECURITY HEADERS
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false
  })
);

// 2. CORS CONFIGURATION
const allowedOrigins = [
  'https://my-media-s4g1.onrender.com',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
  'http://localhost:5500'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Mobile / Web Client direct access support
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.static('public')); // Serve index.html if placed inside 'public' directory

// 3. RATE LIMITING
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: "Bohot saare requests bheje gaye hain. Kripya 15 minute baad try karein." }
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: "Upload limit exceed ho gayi hai. 15 minute baad dubara try karein." }
});

app.use('/api/', generalLimiter);

// 4. SUPABASE INITIALIZATION
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET_NAME = process.env.BUCKET_NAME || "my-media";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("FATAL ERROR: Supabase environment variables configured nahi hain!");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 5. FILE FILTER & MULTER CONFIG
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB
    files: 5
  },
  fileFilter: fileFilter
});

// Root API Check
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Media Secure Backend API Running!' });
});

// 6. UPLOAD API
app.post('/api/upload', uploadLimiter, (req, res) => {
  upload.array('files', 5)(req, res, async (err) => {
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
      res.status(500).json({ error: "File upload karne me internal error aaya." });
    }
  });
});

// 7. FEED API
app.get('/api/feed', async (req, res) => {
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .list('', {
        limit: 100,
        sortBy: { column: 'created_at', order: 'desc' }
      });

    if (error) throw error;

    // Filter out hidden/system placeholder files
    const validFiles = data.filter(item => item.name !== '.emptyFolderPlaceholder');

    const feedItems = validFiles.map(item => {
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

app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err.stack);
  res.status(500).json({ error: "Server me error aaya hai." });
});

app.listen(PORT, () => {
  console.log(`Server running securely on port ${PORT}`);
});
