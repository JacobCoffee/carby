import { test } from "bun:test";
import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import {
  foodFromCalculation,
  foodItemsNote,
  mealLabel,
  mealDoseFoods,
  mealLinks,
  relatedMealRecords,
  attachMealFood,
  calculationRecords,
  insertMealFoodSql,
  attachMealFoodSql,
} from "../lib/meal-log.ts";
import { entrySchema } from "../lib/care.ts";
const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
const calculation = {
  mode: "Carbs",
  carbs: 27,
  glucose: null,
  source: null,
  foodEntryIds: [],
  foodDescription: "Example cereal and milk",
  calculatedUnits: 0.5,
  target: 140,
  factor: 80,
  ratio: 40,
};
const dose = entrySchema.parse({
  id: ids[0],
  kind: "insulin",
  at: "2026-09-25T16:02:00.000Z",
  glucose: null,
  source: null,
  ketones: null,
  carbs: null,
  units: 0.5,
  insulin: "Rapid-acting",
  purpose: "Meal only",
  meal: null,
  note: "",
  calculation,
});
const food = foodFromCalculation(ids[1], "2026-09-25T15:55:00.000Z", calculation, "Breakfast", [
  { name: "Example cereal", carbs: 21, amount: 0.5, unit: "cup" },
  { name: "Example milk", carbs: 6, amount: 1, unit: "cup" },
]);

test("paired food keeps portions, meal type and independently confirmed time", () => {
  const linked = attachMealFood(dose, food);
  assert.equal(food.carbs, 27);
  assert.equal(food.foodItems.length, 2);
  assert.equal(food.at, "2026-09-25T15:55:00.000Z");
  assert.equal(linked.at, dose.at);
  assert.equal(linked.units, 0.5);
  assert.equal(linked.calculation.calculatedUnits, 0.5);
  assert.deepEqual(linked.calculation.foodEntryIds, [food.id]);
  assert.deepEqual(calculationRecords(linked, null, food), [linked, food]);
  assert.equal(mealLabel("lunch"), "Lunch");
  assert.equal(mealLabel(), "Meal");
});

test("foods picked in the calculator become the food record's items and note", () => {
  const items = [
    { name: "Example cereal", carbs: 21.333, amount: 0.6667, unit: "cup", savedFoodId: ids[2] },
    { name: "Example milk", carbs: 6, amount: 1, unit: "cup" },
  ];
  const note = foodItemsNote(items);
  assert.equal(note, "Example cereal: 0.67 cup; Example milk: 1 cup");
  const picked = foodFromCalculation(
    ids[1],
    "2026-09-25T15:55:00.000Z",
    { ...calculation, carbs: 27.33, foodDescription: note },
    "Snack",
    items,
  );
  assert.equal(picked.note, note);
  assert.equal(picked.foodItems[0].savedFoodId, ids[2]);
  assert.equal(entrySchema.safeParse(picked).success, true);
});

test("links are explicit and bidirectional without duplicating separately logged food", () => {
  const linked = attachMealFood(dose, food);
  assert.equal(mealLinks([dose, { ...food, at: dose.at }]).length, 0);
  assert.deepEqual(relatedMealRecords(food, [linked, food]), [linked]);
  assert.deepEqual(relatedMealRecords(linked, [linked, food]), [food]);
  assert.deepEqual(calculationRecords(linked, null, null), [linked]);
  assert.equal(mealLinks([linked]).length, 0); // Deleted or out-of-day food is not invented.
  assert.equal(
    mealLinks([
      { ...linked, calculation: { ...linked.calculation, foodEntryIds: [food.id, food.id] } },
      food,
    ]).length,
    1,
  );
});

test("cannot add food twice, link a wrong amount, or turn a correction-only dose into food", () => {
  assert.throws(() => attachMealFood(attachMealFood(dose, food), food));
  assert.throws(() => attachMealFood(dose, { ...food, carbs: 28 }));
  assert.throws(() =>
    foodFromCalculation(ids[1], food.at, { ...calculation, mode: "Correction", carbs: 0 }, "Meal"),
  );
  assert.throws(() =>
    foodFromCalculation(ids[1], food.at, calculation, "Meal", [
      { name: "Wrong portion", carbs: 10, amount: 1, unit: "cup" },
    ]),
  );
});

test("paired writes reject colliding IDs and inconsistent new-food links", () => {
  const linked = attachMealFood(dose, food);
  assert.throws(() => calculationRecords(linked, { ...food, id: dose.id }, food), /different ID/);
  assert.throws(() => calculationRecords(dose, null, food), /match/);
  assert.throws(() => calculationRecords(linked, null, { ...food, carbs: 28 }), /match/);
});

function fixture() {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE entries (id TEXT PRIMARY KEY, owner TEXT NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL, plan TEXT NOT NULL, updated TEXT NOT NULL)",
  );
  db.prepare("INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?)").run(
    dose.id,
    "owner",
    dose.at,
    JSON.stringify(dose),
    "{}",
    "v1",
  );
  return db;
}
function confirm(db, foodRecord, source = JSON.stringify(dose), revision = "v1", owner = "owner") {
  const foodData = JSON.stringify(foodRecord),
    next = JSON.stringify(attachMealFood(dose, foodRecord));
  db.exec("BEGIN");
  try {
    const created = db
      .prepare(insertMealFoodSql)
      .run(
        foodRecord.id,
        owner,
        foodRecord.at,
        foodData,
        "{}",
        "v2",
        dose.id,
        owner,
        source,
        revision,
      );
    const attached = db
      .prepare(attachMealFoodSql)
      .run(next, "v2", dose.id, owner, source, revision, foodRecord.id, owner, foodData);
    db.exec("COMMIT");
    return { created: created.changes, attached: attached.changes, next };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
test("legacy food and dose link commit together and a stale second confirmation creates no extra food", () => {
  const db = fixture();
  const first = confirm(db, food);
  assert.equal(first.created, 1);
  assert.equal(first.attached, 1);
  assert.equal(
    JSON.parse(db.prepare("SELECT data FROM entries WHERE id = ?").get(dose.id).data).calculation
      .foodEntryIds[0],
    food.id,
  );
  const second = confirm(db, { ...food, id: ids[2] });
  assert.equal(second.created, 0);
  assert.equal(second.attached, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM entries").get().n, 2);
  db.close();
});
test("changed, deleted or differently owned source records never leave orphan food", () => {
  for (const scenario of ["changed", "deleted", "owner"]) {
    const db = fixture();
    if (scenario === "changed")
      db.prepare("UPDATE entries SET data = ? WHERE id = ?").run(
        JSON.stringify({ ...dose, units: 1 }),
        dose.id,
      );
    if (scenario === "deleted") db.prepare("DELETE FROM entries WHERE id = ?").run(dose.id);
    const result = confirm(
      db,
      food,
      JSON.stringify(dose),
      "v1",
      scenario === "owner" ? "another-owner" : "owner",
    );
    assert.equal(result.created, 0);
    assert.equal(result.attached, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM entries WHERE id = ?").get(food.id).n, 0);
    db.close();
  }
});

test("older meal-dose details appear without creating or changing care records", () => {
  const before = JSON.stringify(dose),
    details = mealDoseFoods([dose]);
  assert.equal(details.length, 1);
  assert.equal(details[0].carbs, 27);
  assert.equal(details[0].at, dose.at);
  assert.equal(details[0].dose, dose);
  assert.equal(details[0].description, "Example cereal and milk");
  assert.equal(details[0].id, `dose-food:${dose.id}`);
  assert.equal(JSON.stringify(dose), before);
  assert.equal(entrySchema.safeParse(details[0]).success, false);
});

test("linked, deleted-linked, correction and explicitly dose-only logs do not produce meal details", () => {
  const linked = attachMealFood(dose, food);
  assert.deepEqual(mealDoseFoods([linked, food]), []);
  assert.deepEqual(mealDoseFoods([linked]), []);
  assert.deepEqual(
    mealDoseFoods([{ ...dose, calculation: { ...calculation, mode: "Correction", carbs: 0 } }]),
    [],
  );
  assert.deepEqual(
    mealDoseFoods([{ ...dose, calculation: { ...calculation, foodLog: "dose-only" } }]),
    [],
  );
  assert.equal(
    entrySchema.parse({ ...dose, calculation: { ...calculation, foodLog: "dose-only" } })
      .calculation.foodLog,
    "dose-only",
  );
});
