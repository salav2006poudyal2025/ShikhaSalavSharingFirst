const multer = require("multer");

const storage = multer.memoryStorage();

function imageFilter(req, file, cb) {
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only JPEG, PNG, WEBP, and GIF image files are allowed."), false);
  }
}

const uploadHostelImages = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
}).array("images", 8);

module.exports = { uploadHostelImages };

