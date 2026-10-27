// Tests for chart-merge.js (our table → the chart app's grid)
const assert = require("assert");
const M = require("../js/chart-merge.js");
let n = 0;
const t = (name, fn) => { fn(); n++; };

const tsv = "\t\tParacetamol 500mg Tab\tOmeprazole 20mg cap\nتجربة 1\t9001\t6\t1\nتجربة 2\t٩٠٠٢\tكل يومين\t2";

t("parse: names, plates (Arabic digits → Latin), quantities", () => {
  const d = M.parseTsv(tsv);
  assert.deepStrictEqual(d.meds, ["Paracetamol 500mg Tab", "Omeprazole 20mg cap"]);
  assert.strictEqual(d.rows[1].plate, "9002");
  assert.deepStrictEqual(d.rows[0].qty, ["6", "1"]);
  assert.strictEqual(M.parseTsv("garbage"), null);
});

t("empty chart: rows 1-2, columns 1-2, non-numeric skipped", () => {
  const { body, summary } = M.merge(null, M.parseTsv(tsv));
  assert.strictEqual(body.patients.length, 41);
  assert.strictEqual(body.columns.length, 51);
  assert.deepStrictEqual(body.patients.slice(0, 2).map(p => [p.name, p.patientId]), [["تجربة 1", "9001"], ["تجربة 2", "9002"]]);
  assert.deepStrictEqual(body.columns.slice(0, 2).map(c => c.medicineName), ["Paracetamol 500mg Tab", "Omeprazole 20mg cap"]);
  assert.deepStrictEqual(body.quantities, [
    { rowNumber: 1, columnNumber: 1, quantity: 6 }, { rowNumber: 1, columnNumber: 2, quantity: 1 }, { rowNumber: 2, columnNumber: 2, quantity: 2 }
  ]);
  assert.strictEqual(summary.newPatients, 2);
  assert.strictEqual(summary.skipped.length, 1);
});

t("existing chart: keeps other work, reuses row (plate) and column (name, any case)", () => {
  const chart = {
    version: 5,
    patients: [{ row_number: 1, patient_name: "مريض يدوي", patient_id: "100" }, { row_number: 2, patient_name: "تجربة 2", patient_id: "9002" }],
    columns: [{ column_number: 1, medicine_name: "Heparin vial" }, { column_number: 2, medicine_name: "omeprazole 20mg CAP" }],
    quantities: [{ row_number: 1, column_number: 1, quantity: 1 }, { row_number: 2, column_number: 2, quantity: 1 }]
  };
  const { body, summary } = M.merge(chart, M.parseTsv("\t\tOmeprazole 20mg cap\tCeftriaxone 1g vial\nتجربة 2\t9002\t3\t2"));
  assert.strictEqual(body.patients[0].name, "مريض يدوي");                 // untouched
  assert.strictEqual(body.columns[0].medicineName, "Heparin vial");       // untouched
  assert.strictEqual(body.columns[2].medicineName, "Ceftriaxone 1g vial"); // new → first empty column
  assert.deepStrictEqual(body.quantities, [
    { rowNumber: 1, columnNumber: 1, quantity: 1 },
    { rowNumber: 2, columnNumber: 2, quantity: 3 },                       // updated 1 → 3
    { rowNumber: 2, columnNumber: 3, quantity: 2 }
  ]);
  assert.strictEqual(summary.newPatients, 0);
  assert.strictEqual(summary.newMeds, 1);
});

t("re-sending the same table changes nothing", () => {
  const first = M.merge(null, M.parseTsv(tsv)).body;
  const asChart = {
    patients: first.patients.map(p => ({ row_number: p.rowNumber, patient_name: p.name, patient_id: p.patientId })),
    columns: first.columns.map(c => ({ column_number: c.columnNumber, medicine_name: c.medicineName })),
    quantities: first.quantities.map(q => ({ row_number: q.rowNumber, column_number: q.columnNumber, quantity: q.quantity }))
  };
  assert.deepStrictEqual(M.merge(asChart, M.parseTsv(tsv)).body, first);
});

t("full chart: extra patients are reported, not dropped silently", () => {
  const chart = { patients: Array.from({ length: 41 }, (_, i) => ({ row_number: i + 1, patient_name: "P" + i, patient_id: String(i) })), columns: [], quantities: [] };
  const { summary } = M.merge(chart, M.parseTsv("\t\tX\nجديد\t999\t1"));
  assert.ok(summary.skipped.some(s => /صفوف فارغة/.test(s)));
});

t("matchCatalogue: spelling / spacing / form words, same strength only", () => {
  const cat = ["Paracetamol 500mg Tab", "Paracetamol 1g vial", "Ceftrixone 1g vial", "Vancomycin 500 mg vial", "Omeprazole 20mg cap", "Omeprazole 40mg cap", "Keppra 500mg tab", "كانيولا"];
  const m = M.matchCatalogue(["paracetamol 500 mg tablet", "Ceftriaxone 1g vial", "Vancomycin 500mg vial", "Omeprazole 20mg capsule", "Omeprazole 30mg cap", "Keppra 500 tab", "كانيولا", "Unknown 5mg"], cat);
  assert.strictEqual(m.get("paracetamol 500 mg tablet"), "Paracetamol 500mg Tab");
  assert.strictEqual(m.get("Ceftriaxone 1g vial"), "Ceftrixone 1g vial");
  assert.strictEqual(m.get("Vancomycin 500mg vial"), "Vancomycin 500 mg vial");
  assert.strictEqual(m.get("Omeprazole 20mg capsule"), "Omeprazole 20mg cap");
  assert.strictEqual(m.get("Omeprazole 30mg cap"), null);          // never a different strength
  assert.strictEqual(m.get("Keppra 500 tab"), null);               // "500" ≠ "500mg" → not guessed
  assert.strictEqual(m.get("كانيولا"), "كانيولا");
  assert.strictEqual(m.get("Unknown 5mg"), null);
});
t("verify: reports medicines the chart did not keep", () => {
  const { body } = M.merge(null, M.parseTsv("\t\tA 1mg tab\tB 2mg tab\nx\t1\t1\t2"));
  const saved = { patients: [{ row_number: 1, patient_name: "x", patient_id: "1" }], columns: [{ column_number: 1, medicine_name: "A 1mg tab" }], quantities: [{ row_number: 1, column_number: 1, quantity: 1 }] };
  const miss = M.verify(saved, body);
  assert.deepStrictEqual(miss.meds, ["B 2mg tab"]);
  assert.strictEqual(miss.cells, 1);
  assert.strictEqual(miss.patients.length, 0);
});
t("no empty column left → a new column is added after the last one (up to 60)", () => {
  const cols = Array.from({ length: 51 }, (_, k) => ({ column_number: k + 1, medicine_name: "Med" + (k + 1) }));
  const chart = { version: 3, patients: [], columns: cols, quantities: [] };
  const data = { meds: ["Brand New 1g vial"], rows: [{ name: "علي", plate: "123456", qty: ["2"] }] };
  const { body, summary } = M.merge(chart, data, null);
  assert.strictEqual(body.columns.length, 52);
  assert.strictEqual(body.columns[51].medicineName, "Brand New 1g vial");
  assert.strictEqual(summary.addedColumns, 1);
  assert.deepStrictEqual(body.quantities, [{ rowNumber: 1, columnNumber: 52, quantity: 2 }]);
  assert.strictEqual(summary.skipped.length, 0);
});
t("columns stop at 60: the extra medicine is reported, not sent", () => {
  const cols = Array.from({ length: 60 }, (_, k) => ({ column_number: k + 1, medicine_name: "Med" + (k + 1) }));
  const { body, summary } = M.merge({ version: 1, patients: [], columns: cols, quantities: [] },
    { meds: ["One More"], rows: [{ name: "علي", plate: "1", qty: ["1"] }] }, null);
  assert.strictEqual(body.columns.length, 60);
  assert.ok(summary.skipped.some(s => /الحد 60/.test(s)));
});

t("no empty row: the patient is returned as overflow (for the extra chart), not skipped", () => {
  const rows = Array.from({ length: 41 }, (_, k) => ({ row_number: k + 1, patient_name: "م" + k, patient_id: String(100000 + k) }));
  const chart = { version: 1, patients: rows, columns: [], quantities: [] };
  const data = { meds: ["Paracetamol 500mg Tab"], rows: [{ name: "جديد", plate: "999999", qty: ["2"] }, { name: "م3", plate: "100003", qty: ["1"] }] };
  const r = M.merge(chart, data, null, { collectOverflow: true });
  assert.deepStrictEqual(r.overflow.map(x => x.name), ["جديد"]);
  assert.strictEqual(r.summary.skipped.length, 0);
  assert.strictEqual(r.summary.patients, 1);                 // the one already in the chart is still updated
});
t("without collectOverflow the old message is kept", () => {
  const rows = Array.from({ length: 41 }, (_, k) => ({ row_number: k + 1, patient_name: "م" + k, patient_id: String(100000 + k) }));
  const r = M.merge({ version: 1, patients: rows, columns: [], quantities: [] }, { meds: ["X"], rows: [{ name: "جديد", plate: "999999", qty: ["1"] }] }, null);
  assert.ok(r.summary.skipped.some(s => /صفوف فارغة/.test(s)));
});
t("skipRow: a patient living in the extra chart is not added to this one", () => {
  const extra = { patients: [{ row_number: 1, patient_name: "س", patient_id: "555555" }] };
  const data = { meds: ["X"], rows: [{ name: "س", plate: "555555", qty: ["1"] }, { name: "ص", plate: "666666", qty: ["1"] }] };
  const r = M.merge(null, data, null, { collectOverflow: true, skipRow: (row) => M.hasPatient(extra, row) });
  assert.deepStrictEqual(r.overflow.map(x => x.name), ["س"]);
  assert.strictEqual(r.summary.newPatients, 1);
});
t("subset keeps only the medicines the overflow patients have a quantity for", () => {
  const data = { meds: ["A", "B", "C"], rows: [{ name: "1", plate: "1", qty: ["1", "", ""] }, { name: "2", plate: "2", qty: ["", "", "3"] }] };
  const s = M.subset(data, [data.rows[1]]);
  assert.deepStrictEqual(s.meds, ["C"]);
  assert.deepStrictEqual(s.rows[0].qty, ["3"]);
});

console.log(n + " tests passed");
