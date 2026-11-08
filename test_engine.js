const fs = require("fs");
const path = require("path");
const engine = require("./web/engine.js");

const testPath = path.join(__dirname, "data", "시험_요구문항_40건.csv");
const rulePath = process.argv[2];
const testRows = engine.parseCsv(fs.readFileSync(testPath, "utf8"));

async function main() {
  if (rulePath) await engine.init({ rulePath: path.resolve(rulePath) });

  let firstPlaceCorrect = 0;
  let topThreeCorrect = 0;
  const wrongRows = [];

  for (const row of testRows) {
    const result = engine.classify(row.요구내용);
    const departments = result.map((candidate) => candidate.과);

    if (departments[0] === row.정답_배분과) firstPlaceCorrect += 1;
    if (departments.includes(row.정답_배분과)) topThreeCorrect += 1;

    if (departments[0] !== row.정답_배분과) {
      wrongRows.push({
        시험번호: row.시험번호,
        요구내용: row.요구내용,
        정답: row.정답_배분과,
        "엔진 결과": result
          .map((candidate) => `${candidate.과}(${candidate.점수}, ${candidate.근거키워드})`)
          .join(" / ") || "후보 없음",
      });
    }
  }

  console.log(`1순위 정답 ${firstPlaceCorrect}/${testRows.length} · 3순위 안 ${topThreeCorrect}/${testRows.length}`);
  console.log("\n틀린 문항 표");
  console.table(wrongRows);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
