const fs = require('fs'), path = require('path');
const FILE = path.join(__dirname, '..', 'data.json');
let db = { projects: [], payments: [], subscriptions: [] };
if (fs.existsSync(FILE)) db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const save = () => fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
module.exports = { db, save };
