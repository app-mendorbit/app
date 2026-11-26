/**
 * ========================================================================
 * MENDORBIT DPP ENGINE — GOOGLE APPS SCRIPT (dpp-engine.gs)
 * ========================================================================
 * Attach this script to your FRESH Google Spreadsheet created solely for DPPs.
 *
 * Spreadsheet Setup:
 *  - Each Sheet Tab corresponds to a DPP Sheet Tab name configured in Admin Panel
 *    (e.g., "Legal_Reasoning_DPP_1", "CLAT_QT_Set_1", "Sheet1").
 *  - Row 1 (Headers — case-insensitive):
 *    QNo | Question | OptionA | OptionB | OptionC | OptionD | CorrectOption | Explanation | SolutionUrl | Topic
 *    - CorrectOption accepts: A, B, C, D (or 1, 2, 3, 4)
 *
 * Deployment:
 *  1. Extensions -> Apps Script -> paste this code.
 *  2. Deploy -> New deployment -> Web app -> Execute as: Me -> Who has access: Anyone.
 *  3. Copy the /exec Web App URL into `CONFIG.DPP_APPS_SCRIPT_URL` in `cloudflare-worker/worker.js`
 *     (or set it per batch inside Admin Console -> Batch Content Manager).
 * ========================================================================
 */

function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = String(params.action || "getDpp").trim();
    var sheetTab = String(params.sheetTab || "").trim();
    var batchId = String(params.batchId || "").trim();
    var dppId = String(params.dppId || "").trim();

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === "listTabs") {
      var tabs = ss.getSheets().map(function (s) {
        return { name: s.getName(), rowCount: Math.max(0, s.getLastRow() - 1) };
      });
      return jsonOut({ status: "success", tabs: tabs });
    }

    var sheet = null;
    if (sheetTab) {
      sheet = ss.getSheetByName(sheetTab);
      if (!sheet) {
        var sheets = ss.getSheets();
        var lowerTarget = sheetTab.toLowerCase();
        for (var i = 0; i < sheets.length; i++) {
          if (sheets[i].getName().toLowerCase() === lowerTarget) {
            sheet = sheets[i];
            break;
          }
        }
      }
    }
    if (!sheet && dppId) {
      sheet = ss.getSheetByName(dppId);
    }
    if (!sheet) {
      return jsonOut({
        status: "error",
        message: "DPP tab '" + (sheetTab || dppId || "(empty)") + "' not found in DPP spreadsheet.",
        questions: []
      });
    }

    var values = sheet.getDataRange().getDisplayValues();
    if (!values || values.length < 2) {
      return jsonOut({
        status: "success",
        batchId: batchId,
        sheetTab: sheet.getName(),
        total: 0,
        questions: []
      });
    }

    var rawHeaders = values[0];
    var colIndex = {};
    for (var h = 0; h < rawHeaders.length; h++) {
      var norm = String(rawHeaders[h] || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (norm) colIndex[norm] = h;
    }

    function cell(row, keys, fallbackIdx) {
      for (var k = 0; k < keys.length; k++) {
        if (colIndex[keys[k]] !== undefined) {
          return String(row[colIndex[keys[k]]] || "").trim();
        }
      }
      if (fallbackIdx !== undefined && fallbackIdx < row.length) {
        return String(row[fallbackIdx] || "").trim();
      }
      return "";
    }

    function normalizeCorrect(val) {
      var v = String(val || "").trim().toUpperCase();
      if (v === "1" || v === "OPTIONA" || v === "OPTION A") return "A";
      if (v === "2" || v === "OPTIONB" || v === "OPTION B") return "B";
      if (v === "3" || v === "OPTIONC" || v === "OPTION C") return "C";
      if (v === "4" || v === "OPTIOND" || v === "OPTION D") return "D";
      if (["A", "B", "C", "D"].indexOf(v) !== -1) return v;
      return "A";
    }

    var questions = [];
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var qText = cell(row, ["question", "ques", "q", "prompt"], 1);
      if (!qText) continue;

      var qNo = cell(row, ["qno", "no", "sno", "number"], 0) || String(questions.length + 1);
      var optA = cell(row, ["optiona", "opta", "a"], 2);
      var optB = cell(row, ["optionb", "optb", "b"], 3);
      var optC = cell(row, ["optionc", "optc", "c"], 4);
      var optD = cell(row, ["optiond", "optd", "d"], 5);
      var correct = normalizeCorrect(cell(row, ["correctoption", "correct", "answer", "ans"], 6));
      var explanation = cell(row, ["explanation", "solution", "exp", "hint"], 7);
      var solutionUrl = cell(row, ["solutionurl", "solurl", "pdflink", "videourl", "link"], 8);
      var topic = cell(row, ["topic", "subject", "tag"], 9);

      questions.push({
        qNo: qNo,
        question: qText,
        options: { A: optA, B: optB, C: optC, D: optD },
        correctOption: correct,
        explanation: explanation,
        solutionUrl: solutionUrl,
        topic: topic
      });
    }

    return jsonOut({
      status: "success",
      batchId: batchId,
      sheetTab: sheet.getName(),
      total: questions.length,
      questions: questions
    });
  } catch (err) {
    return jsonOut({ status: "error", message: String(err && err.message ? err.message : err), questions: [] });
  }
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
