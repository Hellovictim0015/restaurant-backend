import { Router } from 'express';
import multer from 'multer';
import { success, failure } from '../lib/response.js';
import { validateImageFile, uploadImageBuffer, MAX_SIZE_BYTES } from '../lib/cloudinary.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

const ALLOWED_FOLDERS = ['categories', 'products', 'restaurant'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES, files: 1 },
});

// multipart/form-data: `file` + `folder` (categories | products | restaurant)
router.post('/', requireAdmin, upload.single('file'), async (req, res) => {
  const folder = req.body?.folder || 'products';
  if (!ALLOWED_FOLDERS.includes(folder)) {
    return failure(res, 'Invalid upload folder', 400);
  }

  const validationError = validateImageFile(req.file);
  if (validationError) return failure(res, validationError, 400);

  try {
    const { url, publicId } = await uploadImageBuffer(req.file.buffer, folder);
    return success(res, { url, publicId }, 'Image uploaded successfully');
  } catch (error) {
    console.error('Cloudinary upload failed:', error);
    return failure(res, 'Image upload failed. Please try again.', 502);
  }
});

export default router;
