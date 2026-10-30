/* ============================================================
   ministry-forms.js  —  the Ministry of Health «موقف» forms (Google Forms)
   ============================================================
   Used by the page «مواقف وزارة الصحة» (js/ministry.js, in the browser) and by the server function
   api/ministry-send.js (Node) — the server only ever posts to the forms listed HERE, and checks every value
   against the same lists, so a request can never reach another address or send an option the form does not have.

   Every form is a list of FIELDS. A form is sent the way the browser sends it: POST …/formResponse with
   entry.<id> = value for every answer and pageHistory = the pages the answerer went through (a form that branches
   on the diagnosis has one page per branch). Entry ids / pages / options were read from the forms themselves
   (FB_PUBLIC_LOAD_DATA_).

   field = { k, label, t, e (entry id), req, ... }
     t "fixed"  a constant (v)                       t "text" / "num"  typed (num = a number)
     t "radio"  one of opts (other: true = or a free text)   t "check"  several of opts (other: true = + a free text)
     t "date"   YYYY-MM-DD                           t "branch"  the diagnosis: a group → its choice (branches)
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MinistryForms = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SEASONS = ["الفصل الاول", "الفصل الثاني", "الفصل الثالث", "الفصل الرابع"];
  const MONTHS = ["الشهر الاول : كانون الثاني", "الشهر الثاني: شباط", "الشهر الثالث: اذار", "الشهر الرابع: نيسان", "الشهر الخامس: ايار", "الشهر السادس: حزيران",
    "الشهر السابع: تموز", "الشهر الثامن: آب", "الشهر التاسع: ايلول", "الشهر العاشر: تشرين الاول", "الشهر الحادي عشر: تشرين الثاني", "الشهر الثاني عشر: كانون الاول"];
  const INSTITUTION = "مستشفى بغداد التعليمي العام";
  const YN = ["نعم", "لا"];

  // fields the IVIG and albumin forms share
  const common = (e) => [
    { k: "institution", label: "المؤسسة", t: "fixed", e: e.institution, v: INSTITUTION },
    { k: "season", label: "الفصل", t: "radio", e: e.season, opts: SEASONS, req: 1, half: 1 },
    { k: "month", label: "الشهر", t: "radio", e: e.month, opts: MONTHS, req: 1, half: 1 },
    { k: "name", label: "اسم المريض", t: "text", e: e.name, req: 1 },
    { k: "doctor", label: "اسم الطبيب", t: "text", e: e.doctor, req: 1 },
    { k: "plate", label: "رقم الطبلة", t: "num", e: e.plate, req: 1, half: 1 },
    { k: "gender", label: "الجنس", t: "radio", e: e.gender, opts: ["ذكر", "انثى"], req: 1, half: 1 },
    { k: "age", label: "العمر بالسنوات", t: "num", e: e.age, req: 1, half: 1 },
    { k: "vials", label: "عدد الفيالات المصروفة", t: "num", e: e.vials, req: 1, half: 1 }
  ];

  const FORMS = {
    ivig: {
      id: "ivig", title: "IVIG vial", short: "IVIG", sub: "الغلوبيولين المناعي الوريدي",
      gid: "1FAIpQLSfswB5mpWZU4Hrh9BIimdgmNnDimBdHLrr6bHK0q9fOlpl25A", pages: "0,1",
      fields: common({ institution: 700571695, season: 214137601, month: 1987280467, name: 539442606, doctor: 1069499657, plate: 1249769055, gender: 1595320943, age: 105603720, vials: 2018093175 }).concat([
        {
          k: "branch", label: "التشخيص", t: "branch", e: 1082107107, req: 1, branches: {
            neurology: { label: "Neurology", option: "Part ( neurology)", page: 5, e: 601709297, opts: ["guillian barrie syndrome in case plasmapheresis cannot be done or not available", "myasthenia gravis crisis as life saving measures when plasmapheresis cannot be done or not available"] },
            hematology: { label: "Hematology", option: "Part ( hematology )", page: 4, e: 96234760, opts: ["life threatening bleeding in immune thrombocytopenia", "kawasaki vasculitis", "replacement therapy in congenital hypogammaglobulinemia"] },
            nephrology: { label: "Nephrology", option: "Part ( nephrology )", page: 3, e: 1537971111, opts: ["biopsy proven acute antibody mediated rejection", "biopsy proven chronic active antibody mediated rejection", "pre transplant desensitization protocol for highly sensitized patients", "transplant BK virus nephropathy / biopsy proven and resistant to standard therapy", "severe case of fulminant lupus nephritis not responding to therapy", "catastrophic antiphospholipid syndrome", "severe cytopenia and sepsis during treatment of glomerulonephritis or SLE and transplantation receiving aggressive immunosuppression"] },
            others: { label: "Others", option: "others", page: 2, e: 332421866, free: 1 }
          }
        }])
    },

    albumin: {
      id: "albumin", title: "Albumin vial", short: "Albumin", sub: "الألبومين",
      gid: "1FAIpQLSe-IMTxnC28h84i0dKBLMfeB8QLS_AkgRXICkUOhbVzGfaPgw", pages: "0,1",
      fields: common({ institution: 1214806455, season: 589084363, month: 1792534844, name: 423556593, doctor: 2078163932, plate: 1062167645, gender: 1143953533, age: 1373968846, vials: 1161018343 }).concat([
        { k: "waste", label: "الكمية الضائعة من المادة بسبب الجرعة (مليلتر)", t: "num", e: 1124900641, req: 1, half: 1 },
        {
          k: "branch", label: "التشخيص", t: "branch", e: 181711708, req: 1, branches: {
            part1: { label: "Part I", option: "Part I", page: 6, e: 405609873, opts: [
              "large volume paracentesis in patients with cirrhosis and refractory ascites associated with portal hypertention (>4 L removed with documented cirrhosis)",
              "malnutrition syndrome :( patients with diarrhea associated with entral feeding intolerance if all the following conditions are met : { significant diarrhea ( >2 L per day)& serum albumin is <2 g per dl }",
              "ascites not responsive to diuretics if serum albumin <2 g per dl",
              "burns : ( not in the resuscitation phase in the first 24 hr after burn injuries accordind to the body surface area )",
              "hyperbilirubinemia of the newborns",
              "plasma exchange ( with isotonic solutions )",
              "severe hypoalbuminemia with low plasma volume and generalized oedema where salt and water restriction with plasma volume expansion are required"] },
            part2: { label: "Part II", option: "Part II", page: 5, e: 12553619, opts: [
              "plasmapheresis",
              "HRS and serum creatinine > 1.5 mg / dl in presence cirrhosis",
              "HRS and absence of shock, ongoing bacterial infection, and/or current treatment with nephrotoxic drugs",
              "HRS and absence of sustained improvement in renal function after discontinuation of diuretics and a trial of albumin 1 g /kg",
              "HRS and absence of proteinuria (<500 mg/day) or hematuria (<50 red cells per high power field)",
              "HRS and absence of ultrasonographic evidence of obstructive uropathy or parenchymal renal disease",
              "postoperative volume resuscitation after cardiac surgery, or major surgery in the liver or bowel (as a post operative volume expender, as a last choice of treatment after crystalloids or non-protein colloids)",
              "Spontaneous bacterial peritonitis and cirrhosis defined as patient with ascitic fluid, PMN count ≥250 cells / mm3 plus at least one of the following (1- serum creatinine >1 mg/dl. 2- Blood urea nitrogen >30 mg/dl. 3- Total bilirubin >4 mg/dl)",
              "Major Hepatic Resection (>40% resected), in patient with serum albumin <2.5g/dl if a crystalloid alone fail to achieve adequate intravascular volume)",
              "Post Operative Liver Transplant (May be useful for control ascites and peripheral edema if serum albumin is <2.5g/dl)"] },
            part3: { label: "Part III", option: "Part III", page: 4, e: 1929070663, opts: [
              "Acute Nephrotic Syndrome with sever refractory edema and anasarca or pulmonary edema with >3g/day of urinary protein excretion + hypercholesterolemia + hypoalbuminemia)",
              "Acute Nephrotic Syndrome with sever refractory edema and anasarca or pulmonary edema with loop diuretics resistance (in sufficient response to IV bolus dose of ≥ 160 mg furosemide followed by ≥  8 hrs infusion of ≥ 20mg/hr furosemide)",
              "Acute Nephrotic Syndrome with symptoms and signs of subacute intravascular volume depletion include (Oliguria)",
              "Acute Nephrotic Syndrome with symptoms and signs of subacute intravascular volume depletion include (poor peripheral perfusion)",
              "Acute Nephrotic Syndrome with symptoms and signs of subacute intravascular volume depletion include (abdominal pain, raised creatinine and hematocrit)",
              "Acute Nephrotic Syndrome with symptoms and signs of subacute intravascular volume depletion include (always under supervision of consultant pediatric nephrologist) )",
              "Acute Nephrosis / chronic glomerular nephritis and subsequent hypoalbuminemia"] },
            part4: { label: "Part IV", option: "Part IV", page: 3, e: 1089407135, opts: [
              "Albuminemia > 2.5 g/dl with exception of particular cases list in the above parts",
              "Acute respiratory distress syndrome",
              "Septic shock",
              "Hypovolemic, bleeding and hemorrhage sock (albumin is used as a second choice when solution of crystalloid or nonprotein colloid (first choice treatment) have already been used at maximum dose without having produced a clinical adequate response and cases which nonprotein colloid are contraindicated)",
              "Non Hemorrhagic shock",
              "Traumatic brain injury",
              "Cerebral ischaemia",
              "Major trauma",
              "Wound Healing",
              "Hypoalbuminemia in the absence of edema and acute hypotension",
              "Ascites responsive to diuretics",
              "Kidney transplant",
              "Abdominal compartment syndrome",
              "Burn in the first 24 hours after burn injury",
              "The use of albumin in the immediate post-operative period is never advised for any other type of operation, other than the aformentioned.",
              "Acute normovolaemic haemodialation in surgery",
              "Malnutrition",
              "Protein losing enteropathies and malabsorption",
              "Acute or chronic pancreatitis",
              "Hemodialysis with no evidence of malnutrition",
              "Ovarian hyperstimulation syndrome"] },
            others: { label: "Others", option: "others", page: 2, e: 568912938, free: 1 }
          }
        }])
    },

    tigecycline: {
      id: "tigecycline", title: "Tigecycline Vial", short: "Tigecycline", sub: "التايجيسايكلين",
      gid: "1FAIpQLSfBv-FQxDd-XA74IKNcSTf-SY7E9vlSBjSTznIt9OSZLKmOUw", pages: "0",
      fields: [
        { k: "season", label: "الفصل", t: "radio", e: 1002732231, opts: ["الاول", "الثاني", "الثالث", "الرابع"], req: 1, half: 1 },
        // the form has no December
        { k: "month", label: "شهر صرف المادة", t: "radio", e: 1361198953, opts: MONTHS.slice(0, 11), req: 1, half: 1 },
        { k: "dept", label: "الدائرة", t: "fixed", e: 1999808431, v: "دائرة مدينة الطب" },
        { k: "institution", label: "المؤسسة", t: "fixed", e: 695478373, v: "م بغداد التعليمي" },
        { k: "name", label: "اسم المريض", t: "text", e: 620374697, req: 1 },
        { k: "plate", label: "رقم الطبلة", t: "num", e: 1799492162, req: 1, half: 1 },
        { k: "gender", label: "الجنس", t: "radio", e: 1364369833, opts: ["ذكر", "أنثى"], req: 1, half: 1 },
        { k: "age", label: "العمر", t: "num", e: 1415542091, req: 1, half: 1 },
        { k: "ward", label: "الردهة", t: "text", e: 1946943036, req: 1, half: 1 },
        { k: "dx", label: "التشخيص", t: "text", e: 1655317224, req: 1 },
        { k: "dose", label: "الجرعة المطلوبة يوميًا", t: "text", e: 380163433, req: 1, half: 1 },
        { k: "days", label: "عدد أيام صرف العلاج", t: "num", e: 100922730, req: 1, half: 1 },
        { k: "creat", label: "Serum Creatinine", t: "text", e: 990249454, req: 1, half: 1 },
        { k: "culture", label: "نتيجة الزرع البكتيري", t: "text", e: 903042108, req: 1, half: 1 },
        { k: "indication", label: "الحالة المصرّح بها", t: "radio", e: 873605897, opts: ["complicated skin and soft tissue infections", "complicated intraabdominal infections"], req: 1 }
      ]
    },

    colistin: {
      id: "colistin", title: "Colistin vial", short: "Colistin", sub: "الكوليستين",
      gid: "1FAIpQLScKnP4IrG9HDHYlHnGr7AYPIVwAMRQTWEYRzm8J0P9fd1B20w", pages: "0,1",
      fields: [
        { k: "institution", label: "المؤسسة", t: "fixed", e: 2071414154, v: INSTITUTION },
        { k: "name", label: "اسم المريض", t: "text", e: 841377494, req: 1 },
        { k: "committee", label: "اسم عضو لجنة المضادات الحياتية", t: "text", e: 194226785, req: 1 },
        { k: "doctor", label: "اسم الطبيب", t: "text", e: 1248618096, req: 1 },
        { k: "ward", label: "ردهة الرقود", t: "text", e: 890134783, req: 1, half: 1 },
        { k: "gender", label: "الجنس", t: "radio", e: 1032199192, opts: ["ذكر", "انثى"], req: 1, half: 1 },
        { k: "age", label: "العمر بالسنوات", t: "num", e: 586078480, req: 1, half: 1 },
        { k: "plate", label: "رقم الطبلة", t: "num", e: 1154502244, req: 1, half: 1 },
        { k: "dx", label: "التشخيص", t: "radio", e: 1668545535, req: 1, other: 1, opts: ["serious infections due to selected aerobic Gram negative bacteria in patients with limited treatment options", "management of chronic pulmonary infection due to pseudomonas aeruginosa in patient with cystic fibrosis"] },
        { k: "start", label: "تاريخ البدء بالعلاج", t: "date", e: 120145077, req: 1, half: 1 },
        { k: "weight", label: "وزن المريض", t: "num", e: 698258849, req: 1, half: 1 },
        { k: "dose", label: "الجرعة المطلوبة يوميًا (ملغ)", t: "num", e: 275553482, req: 1, half: 1 },
        { k: "given", label: "الكمية المصروفة يوميًا (ملغ)", t: "num", e: 703290303, req: 1, half: 1 },
        { k: "waste", label: "الكمية المهدورة يوميًا (ملغ)", t: "num", e: 1765020922, req: 1, half: 1 },
        { k: "sharing", label: "هل طُبّق نظام المشاركة", t: "radio", e: 2011704287, opts: YN, req: 1, half: 1 },
        { k: "days", label: "عدد الأيام المطلوب أخذ العلاج فيها", t: "radio", e: 1332799288, req: 1, other: 1, opts: ["غير محدد من قبل الطبيب"] },
        { k: "creat", label: "serum creatinine (mg/dl)", t: "num", e: 1949051570, req: 1, half: 1 },
        { k: "culture", label: "نتيجة الزرع البكتيري", t: "radio", e: 78709220, opts: ["Resistant", "sensetive", "not done"], req: 1, half: 1 }
      ]
    },

    antibiotics: {
      id: "antibiotics", title: "موقف المضادات الحياتية", short: "المضادات", sub: "استمارة صرف المضادات الحياتية",
      gid: "1FAIpQLSfwLQ0aIHzgMH_bN4c4Xy_0uODQbPIlwXKiK2oP9AhViAo0Bw", pages: "0", anyAntibiotic: 1,
      fields: [
        { k: "name", label: "اسم المريض", t: "text", e: 1839216805, req: 1 },
        { k: "age", label: "العمر", t: "num", e: 1627597129, req: 1, half: 1 },
        { k: "ward", label: "الردهة", t: "radio", e: 1486217124, opts: ["الباطنية", "الجراحة", "النسائية"], req: 1, half: 1 },
        { k: "dx", label: "التشخيص (بالإنكليزية)", t: "text", e: 1035769951, req: 1 },
        { k: "stay", label: "فترة الرقود (أيام)", t: "num", e: 465217375, req: 1, half: 1 },
        { k: "allergy", label: "الحساسية", t: "radio", e: 1754507491, opts: YN, req: 1, half: 1 },
        { k: "count", label: "عدد المضادات الموصوفة", t: "num", e: 1824118508, req: 1, half: 1 },
        { k: "names", label: "اسم المضادات", t: "check", e: 1870237146, req: 1, opts: ["amikacin", "amoxicillin", "augementin", "ceftrixone", "ceftazidime", "cefotaxime", "ciprofloxacin", "colistin", "flagyl", "gentamicin", "levofloxacin", "meropenem", "septrin", "tazocin", "vancomycin"] },
        { k: "oral", label: "فموي", t: "radio", e: 1678380486, opts: YN, req: 1, half: 1 },
        { k: "inj", label: "حقن", t: "radio", e: 1532873503, opts: YN, req: 1, half: 1 },
        { k: "dose", label: "الجرعة", t: "check", e: 125995950, req: 1, other: 1, opts: ["1000 mg", "500 mg", "625 mg", "480 mg", "250 mg", "80 mg", "1000mg", "1000 Mg", "500mg", "500Mg", "500 Mg"] },
        { k: "freq", label: "التكرار", t: "check", e: 1050538281, req: 1, other: 1, opts: ["1", "2", "3", "4", "-1", "-2", "-3", "-4", "=1", "=2", "=3", "=4"] },
        { k: "days", label: "فترة البقاء على المضاد (أيام)", t: "num", e: 1452351949, req: 1, half: 1 },
        { k: "culture", label: "وجود زرع", t: "radio", e: 171154309, opts: YN, req: 1, half: 1 },
        { k: "review", label: "مراجعة وصف المضاد بعد 48-72 ساعة", t: "radio", e: 1361301962, opts: YN, req: 1, half: 1 },
        { k: "same", label: "الاستمرار على نفس الجرعة", t: "radio", e: 1683323978, opts: YN, req: 1, half: 1 },
        { k: "inc", label: "زيادة الجرعة", t: "radio", e: 1513756208, opts: YN, req: 1, half: 1 },
        { k: "dec", label: "تقليل الجرعة", t: "radio", e: 523110038, opts: YN, req: 1, half: 1 },
        { k: "change", label: "تغيير المضاد", t: "radio", e: 1534464915, opts: YN, req: 1, half: 1 },
        { k: "add", label: "إضافة مضاد", t: "radio", e: 59454876, opts: YN, req: 1, half: 1 },
        { k: "stop", label: "توقف مضاد", t: "radio", e: 1742340079, opts: YN, req: 1, half: 1 },
        { k: "cure", label: "شفاء", t: "radio", e: 358680888, opts: YN, req: 1, half: 1 },
        { k: "worse", label: "تدهور", t: "radio", e: 1906237337, opts: YN, req: 1, half: 1 },
        { k: "death", label: "موت", t: "radio", e: 589197855, opts: YN, req: 1, half: 1 },
        { k: "dcCont", label: "خروج مع استمرار المضاد", t: "radio", e: 1918942450, opts: YN, req: 1, half: 1 },
        { k: "dcStop", label: "خروج وتوقف المضاد", t: "radio", e: 979090905, opts: YN, req: 1, half: 1 },
        { k: "floor", label: "الطابق", t: "radio", e: 421475934, req: 1, half: 1, opts: ["١٠", "٩", "٨", "٦", "٥", "٤", "الخدج", "٣", "٢", "ديلز", "عناية"] }
      ]
    }
  };

  // The meropenem follow-up is not a Google Form: pharmacist24.github.io/allform keeps a register and, when the patient's course ends, posts ONE
  // JSON row to this Google Apps Script (the sheet). Same fields, same names as that page sends.
  FORMS.meronem = {
    id: "meronem", title: "Meropenem", short: "Meronem", sub: "سجل الميرونيم — يُرسل صف واحد لكل مريض",
    kind: "script", once: 1,
    url: "https://script.google.com/macros/s/AKfycbwI12_KSHQ95cew4Q6f9W9je2_lCSgifqxDFayupc7deCypjUrZN6ROL66GzIB_elJH/exec",
    fields: [
      { k: "name", label: "اسم المريض", t: "text", req: 1 },
      { k: "age", label: "العمر بالسنوات", t: "num", req: 1, half: 1 },
      { k: "gender", label: "الجنس", t: "radio", opts: ["ذكر", "انثى"], req: 1, half: 1 },
      { k: "dx", label: "التشخيص", t: "radio", req: 1, other: 1, opts: [
        "Acute mastoiditis", "Acute rhinosinusitis due to intubation", "Bacterial meningitis", "Contaminated blast injury (specify location and severity)",
        "Gangrenous cellulitis (necrotizing fasciitis or gas gangrene)", "HAP Post-op, Ventilator ESBL positive", "Infective bronchiectasis exacerbation (with severe lung impairment)",
        "Lung abscess", "NVE - Acute presentation (severe sepsis with ESBL)", "Neutropenic sepsis", "Pleural empyema ESBL positive", "Proven acute pancreatitis",
        "Pyogenic liver abscess", "Radical resection performed", "Severe CAP admitted to ICU", "Severe diabetic foot infection", "Severe secondary peritonitis",
        "Sepsis (specify origin of infection)", "Surgical site infection"] },
      { k: "dose", label: "الجرعة", t: "radio", opts: ["2000 mg", "1000 mg", "500 mg"], req: 1, half: 1 },
      { k: "freq", label: "التكرار (كل كم ساعة)", t: "radio", opts: ["8", "12", "24", "48"], req: 1, half: 1 },
      { k: "sens", label: "فحص الحساسية", t: "radio", opts: ["نعم", "كلا"], req: 1, half: 1 },
      { k: "pharm", label: "الصيدلاني", t: "text", req: 1, half: 1 },
      { k: "v1", label: "فيالات 1 غ (للعلاج كله)", t: "num", req: 1, half: 1 },
      { k: "v05", label: "فيالات 0.5 غ (للعلاج كله)", t: "num", req: 1, half: 1 },
      { k: "days", label: "مدة العلاج (أيام)", t: "num", req: 1, half: 1 }
    ]
  };
  // → the JSON row the register page itself posts when a patient is discharged
  function toPayload(formId, v) {
    const n = (x) => Number(txt(x)) || 0;
    return {
      timestamp: v.timestamp || new Date().toISOString(), patientName: txt(v.name), age: n(v.age), gender: txt(v.gender), diagnosis: txt(v.dx),
      dosing: txt(v.dose), sensitivityTest: txt(v.sens), frequency: txt(v.freq), duration: n(v.days), pharmacistId: txt(v.pharm),
      meropenem1gQuantity: n(v.v1), meropenem0_5gQuantity: n(v.v05), syncStatus: "Synced"
    };
  }

  const seasonOf = (monthIndex, f) => (f && f.fields.find((x) => x.k === "season") || { opts: SEASONS }).opts[Math.floor(monthIndex / 3)];
  const formUrl = (f) => "https://docs.google.com/forms/d/e/" + f.gid + "/viewform";
  const postUrl = (f) => "https://docs.google.com/forms/d/e/" + f.gid + "/formResponse";
  const txt = (x) => String(x == null ? "" : x).trim();

  // → "" when the values are fine, else the reason (Arabic)
  function validate(formId, v) {
    const f = FORMS[formId];
    if (!f) return "نموذج غير معروف";
    v = v || {};
    for (const fl of f.fields) {
      const val = v[fl.k];
      if (fl.t === "fixed") { if (val !== fl.v) return "قيمة ثابتة غير صحيحة: " + fl.label; continue; }
      if (fl.t === "branch") {
        const b = fl.branches[v.branch];
        if (!b) return "اختر فرع التشخيص";
        if (b.free) { if (!txt(v.dx)) return "اكتب التشخيص"; }
        else if (b.opts.indexOf(v.dx) < 0) return "اختر التشخيص من القائمة";
        continue;
      }
      if (fl.t === "check") {
        const arr = Array.isArray(val) ? val.map(txt).filter(Boolean) : [];
        if (fl.req && !arr.length) return "اختر قيمة: " + fl.label;
        const bad = arr.filter((x) => fl.opts.indexOf(x) < 0);
        if (bad.length && !(fl.other && bad.length === 1)) return "خيار غير موجود في النموذج: " + fl.label;
        continue;
      }
      const s = txt(val);
      if (!s) { if (fl.req) return "مطلوب: " + fl.label; continue; }
      if (fl.t === "num" && !/^\d+(\.\d+)?$/.test(s)) return "رقم فقط: " + fl.label;
      if (fl.t === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(s)) return "تاريخ غير صحيح: " + fl.label;
      if (fl.t === "radio" && fl.opts.indexOf(s) < 0 && !fl.other) return "خيار غير موجود في النموذج: " + fl.label;
      if ((fl.t === "text" || fl.t === "num") && s.length > 500) return "نص طويل جدًا: " + fl.label;
    }
    if (f.kind === "script" && !(Number(txt(v.v1)) > 0 || Number(txt(v.v05)) > 0)) return "أدخل عدد الفيالات";
    return "";
  }

  // → the urlencoded body the form's own page would send
  function toBody(formId, v) {
    const f = FORMS[formId], p = new URLSearchParams();
    let page = "";
    const other = (e, val) => { p.append("entry." + e, "__other_option__"); p.append("entry." + e + ".other_option_response", txt(val)); };
    for (const fl of f.fields) {
      const val = v[fl.k];
      if (fl.t === "fixed") p.append("entry." + fl.e, fl.v);
      else if (fl.t === "branch") {
        const b = fl.branches[v.branch];
        p.append("entry." + fl.e, b.option);
        p.append("entry." + b.e, txt(v.dx));
        page = String(b.page);
      } else if (fl.t === "check") {
        (Array.isArray(val) ? val : []).map(txt).filter(Boolean).forEach((x) => { if (fl.opts.indexOf(x) >= 0) p.append("entry." + fl.e, x); else other(fl.e, x); });
      } else if (fl.t === "date") {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt(val));
        if (m) { p.append("entry." + fl.e + "_year", m[1]); p.append("entry." + fl.e + "_month", String(Number(m[2]))); p.append("entry." + fl.e + "_day", String(Number(m[3]))); }
      } else if (fl.t === "radio" && fl.other && fl.opts.indexOf(txt(val)) < 0) other(fl.e, val);
      else p.append("entry." + fl.e, txt(val));
    }
    p.append("pageHistory", f.pages + (page ? "," + page : ""));
    p.append("fvv", "1");
    return p.toString();
  }

  return { INSTITUTION, SEASONS, MONTHS, FORMS, seasonOf, formUrl, postUrl, validate, toBody, toPayload };
});
