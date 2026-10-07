import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
export const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// `file` is a multer in-memory file ({ mimetype, size, buffer }).
export function validateImageFile(file) {
  if (!file) return 'No file provided';
  if (!ALLOWED_TYPES.includes(file.mimetype)) {
    return 'Only JPG, PNG, or WEBP images are allowed';
  }
  if (file.size > MAX_SIZE_BYTES) {
    return 'Image must be smaller than 5MB';
  }
  return null;
}

export async function uploadImageBuffer(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: `restaurant/${folder}`, resource_type: 'image' },
      (error, result) => {
        if (error) return reject(error);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
}

export async function deleteImage(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch {
    // non-fatal — stale Cloudinary assets can be cleaned up later
  }
}

export default cloudinary;
