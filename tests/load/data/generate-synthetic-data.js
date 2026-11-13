const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const FIRST_NAMES = [
  "Aarav", "Aditi", "Advait", "Akash", "Ananya", "Aniket", "Arjun", "Deepak",
  "Divya", "Gaurav", "Isha", "Kavita", "Kiran", "Madhav", "Manish", "Meera",
  "Neha", "Nikhil", "Pooja", "Pranav", "Priya", "Rahul", "Rakesh", "Rhea",
  "Rohan", "Sanjay", "Shreya", "Siddharth", "Sneha", "Tanvi", "Varun", "Vikram"
];

const LAST_NAMES = [
  "Sharma", "Patel", "Verma", "Reddy", "Singh", "Iyer", "Gupta", "Nair",
  "Deshmukh", "Kulkarni", "Mehta", "Bose", "Menon", "Joshi", "Chopra", "Malhotra"
];

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateIndianName() {
  return `${getRandomElement(FIRST_NAMES)} ${getRandomElement(LAST_NAMES)}`;
}

function generateIndianMobile() {
  // Mobile numbers starting with 98 + 8 random digits (strictly matches ^[6-9]\d{9}$)
  const prefix = "98";
  const suffix = Math.floor(10000000 + Math.random() * 90000000).toString();
  return `${prefix}${suffix}`;
}

function generateSyntheticIp() {
  // Generates unique client IP in the TEST-NET-2 range (198.51.100.0/24) or private (10.X.Y.Z)
  return `10.${getRandomInt(1, 254)}.${getRandomInt(1, 254)}.${getRandomInt(1, 254)}`;
}

function loadTenantsData() {
  const filePath = path.join(__dirname, "test-tenants.json");
  if (!fs.existsSync(filePath)) {
    throw new Error(`test-tenants.json not found at ${filePath}. Please run npm run load:seed first.`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

module.exports = {
  generateIndianName,
  generateIndianMobile,
  generateSyntheticIp,
  getRandomElement,
  getRandomInt,
  loadTenantsData,
};

