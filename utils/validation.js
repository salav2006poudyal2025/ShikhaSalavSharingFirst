const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\d{10}$/;

const EDUCATION_OPTIONS = [
  "Under Graduate (UG)",
  "Post Graduate (PG)",
  "Diploma",
  "PhD / Research",
  "Entrance Exam Preparation",
  "Other",
];

function cleanText(value) {
  return String(value || "").trim();
}

function cleanEmail(value) {
  return cleanText(value).toLowerCase();
}

function isValidEmail(email) {
  return EMAIL_PATTERN.test(cleanEmail(email));
}

function isValidPhone(phone) {
  return PHONE_PATTERN.test(cleanText(phone));
}

function getAge(dob) {
  const birthDate = new Date(dob);
  if (Number.isNaN(birthDate.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  const dayDiff = today.getDate() - birthDate.getDate();

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }

  return age;
}

function validateName(name, label = "Full name") {
  const cleaned = cleanText(name);

  if (!cleaned) return `${label} is required`;
  if (cleaned.length < 3) return `${label} must be at least 3 characters`;
  if (!/^[a-zA-Z\s.'-]+$/.test(cleaned)) {
    return `${label} can only contain letters, spaces, apostrophes, dots, and hyphens`;
  }

  return "";
}

function validateEmail(email) {
  if (!cleanEmail(email)) return "Email is required";
  if (!isValidEmail(email)) return "Invalid email format";
  return "";
}

function validatePassword(password) {
  if (!password) return "Password is required";
  if (String(password).length < 6) {
    return "Password must be at least 6 characters";
  }
  return "";
}

function validatePhone(phone) {
  if (!cleanText(phone)) return "Phone number is required";
  if (!isValidPhone(phone)) {
    return "Phone number must be exactly 10 digits";
  }
  return "";
}

function validateDob(dob) {
  if (!dob) return "Date of birth is required";

  const age = getAge(dob);
  if (age === null) return "Date of birth is invalid";
  if (age < 16) return "Age must be 16 or above";

  return "";
}

function validateEducation(educationStatus) {
  if (!cleanText(educationStatus)) return "Education status is required";
  if (!EDUCATION_OPTIONS.includes(educationStatus)) {
    return "Education status is invalid";
  }
  return "";
}

function validateAddress(address, label) {
  const cleaned = cleanText(address);

  if (!cleaned) return `${label} is required`;
  if (cleaned.length < 5) return `${label} must be at least 5 characters`;

  return "";
}

function validateHostelName(name) {
  const cleaned = cleanText(name);
  if (!cleaned) return "Hostel name is required";
  if (cleaned.length < 3) return "Hostel name must be at least 3 characters";
  return "";
}

function firstValidationError(validations) {
  return validations.find(Boolean) || "";
}

module.exports = {
  EDUCATION_OPTIONS,
  cleanEmail,
  cleanText,
  firstValidationError,
  isValidEmail,
  isValidPhone,
  validateAddress,
  validateDob,
  validateEducation,
  validateEmail,
  validateName,
  validateHostelName,
  validatePassword,
  validatePhone,
};
