const fs = require("fs");
const path = require("path");

const inputPath = path.join(__dirname, "data", "A부_조직도_26개과.csv");
const outputPath = path.join(__dirname, "org.json");

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (insideQuotes && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (character === "," && !insideQuotes) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }

  values.push(value);
  return values;
}

const csvText = fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "").trim();
const lines = csvText.split(/\r?\n/);
const headers = parseCsvLine(lines[0]);

const organizations = lines.slice(1).filter(Boolean).map((line) => {
  const values = parseCsvLine(line);
  const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));

  return {
    실국: row.실국,
    과: row.과,
    대표키워드: row.대표키워드.split("|").filter(Boolean),
  };
});

fs.writeFileSync(outputPath, `${JSON.stringify(organizations, null, 2)}\n`, "utf8");

console.log(`원소 수: ${organizations.length}`);
console.log("첫 원소:");
console.log(JSON.stringify(organizations[0], null, 2));
