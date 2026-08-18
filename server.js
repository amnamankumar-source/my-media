const express = require('express');
const cors = require('cors');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
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
app.use(cors({
  origin: '*', // Production & Mobile client direct support
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 3. RATE LIMITING
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: "Bohot saare requests bheje gaye hain. Kripya 15 minute baad try karein." }
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: "Upload limit exceed ho gayi hai. 15 minute baad dubara try karein." }
});

app.use('/api/', generalLimiter);

// 4. SUPABASE INITIALIZATION (ENV Mismatch Fixed)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const BUCKET_NAME = process.env.BUCKET_NAME || "my-media";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("FATAL ERROR: Supabase Environment Variables Missing!");
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
    fileSize: 25 * 1024 * 1024, // 25MB Max
    files: 5
  },
  fileFilter: fileFilter
});

// Root Health Check API
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Media Backend API Running Perfectly!' });
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
      res.status(500).json({ error: "File upload karte waqt error aaya: " + error.message });
    }
  });
});

// 7. LIVE FEED API
app.get('/api/feed', async (req, res) => {
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .list('', {
        limit: 100,
        sortBy: { column: 'created_at', order: 'desc' }
      });

    if (error) throw error;

    const validFiles = data.filter(item => item.name !== '.emptyFolderPlaceholder' && item.name !== '.keep');

    const feedItems = validFiles.map(item => {
      const { data: urlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(item.name);

      return {
        id: item.id || item.name,
        name: item.name,
        url: urlData.publicUrl,
        created_at: item.created_at
      };
    });

    res.status(200).json({ success: true, feed: feedItems });

  } catch (error) {
    console.error("Feed Fetch Error:", error.message);
    res.status(500).json({ error: "Feed fetch nahi ho paaya: " + error.message });
  }
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err.stack);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(PORT, () => {
  console.log(`Server running securely on port ${PORT}`);
});
