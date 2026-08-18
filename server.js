require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// RAM Memory Storage for Fast Multer Processing
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB max limit
});

// Cloudflare R2 S3 Client Initialization
const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const PUBLIC_DOMAIN = process.env.R2_PUBLIC_DOMAIN; // e.g., https://pub-xxx.r2.dev ya custom domain

// 1. Upload API Route (Single / Multiple Files)
app.post('/api/upload', upload.array('files'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'Koi file upload nahi hui.' });
    }

    const uploadPromises = req.files.map(file => {
      const fileName = `${Date.now()}_${Math.floor(Math.random() * 1000)}_${file.originalname}`;
      
      const uploadParams = {
        Bucket: BUCKET_NAME,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
      };

      return r2Client.send(new PutObjectCommand(uploadParams));
    });

    await Promise.all(uploadPromises);

    res.status(200).json({ 
      success: true, 
      message: 'Sabhi files Cloudflare R2 me store ho gayi!' 
    });
  } catch (error) {
    console.error("Upload Error:", error);
    res.status(500).json({ success: false, message: 'Upload me issue aaya: ' + error.message });
  }
});

// 2. Fetch Feed API Route (Fetch All Uploaded Files for All Users)
app.get('/api/feed', async (req, res) => {
  try {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      MaxKeys: 1000
    });

    const response = await r2Client.send(command);
    
    if (!response.Contents) {
      return res.status(200).json({ success: true, files: [] });
    }

    // Sort newest first
    const sortedFiles = response.Contents.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));

    const files = sortedFiles.map(file => ({
      name: file.Key,
      url: `${PUBLIC_DOMAIN}/${file.Key}`,
      lastModified: file.LastModified
    }));

    res.status(200).json({ success: true, files });
  } catch (error) {
    console.error("Fetch Error:", error);
    res.status(500).json({ success: false, message: 'Feed fetch nahi ho paaya: ' + error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
