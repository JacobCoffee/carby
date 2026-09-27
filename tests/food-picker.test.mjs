import { test } from "bun:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FoodPicker } from "../app/food-picker.tsx";

test("the food picker has no form of its own, so it can sit inside entry and calculator forms", () => {
  // A form nested in another submits as a page load: "Add this food" closed the dialog unsaved.
  const html = renderToStaticMarkup(
    createElement(FoodPicker, {
      savedFoods: [{ id: "f1", name: "Crackers", carbs: 18, serving: 27, unit: "crackers" }],
      items: [],
      onItemsChange() {},
      onSaveFood: async () => true,
      onDeleteFood: async () => true,
    }),
  );
  assert.match(html, /Add this food/);
  assert.doesNotMatch(html, /<form/);
});
