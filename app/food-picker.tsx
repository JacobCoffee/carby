"use client";
import { useId, useState, type FormEvent } from "react";
import { Pencil, Plus, Search, Star, Trash2, X } from "lucide-react";
import type { FoodItem, SavedFood } from "@/lib/care";
import {
  amountInServingUnits,
  parseFoodBasis,
  volumeMl,
  type FoodBasisFields,
} from "@/lib/portions";
import "./food-picker.css";

const fmt = (n: number) => Number(n.toFixed(2)).toString();

/** A food line being built: a serving basis (from a saved food, a recent food, or a
 * fresh quick-add) plus the portion actually eaten. */
type Draft = {
  key: string;
  name: string;
  unit: string;
  servingSize: number;
  carbsPerServing: number;
  portion: string;
  measureIn: "servings" | "amount";
  amountUnit: string;
  savedFoodId?: string;
};

function draftAmount(draft: Draft): number {
  return amountInServingUnits({
    servings: draft.portion,
    servingSize: String(draft.servingSize),
    unit: draft.unit,
    amountUnit: draft.measureIn === "servings" ? draft.unit : draft.amountUnit,
    byServing: draft.measureIn === "servings",
  });
}

function draftCarbs(draft: Draft): number {
  const amount = draftAmount(draft);
  return Number.isFinite(amount) ? (draft.carbsPerServing / draft.servingSize) * amount : NaN;
}

function draftToItem(draft: Draft): FoodItem {
  const carbs = draftCarbs(draft);
  const amount = draftAmount(draft);
  return {
    name: draft.name.trim() || "Unspecified food",
    carbs: Number.isFinite(carbs) ? Math.max(0, Math.min(1000, carbs)) : 0,
    amount: Number.isFinite(amount) ? Math.max(0, Math.min(1000, amount)) : 0,
    unit: draft.measureIn === "servings" ? draft.unit : draft.amountUnit,
    ...(draft.savedFoodId ? { savedFoodId: draft.savedFoodId } : {}),
  };
}

function itemToDraft(item: FoodItem, key: string): Draft {
  return {
    key,
    name: item.name,
    unit: item.unit,
    servingSize: item.amount || 1,
    carbsPerServing: item.carbs,
    portion: "1",
    measureIn: "servings",
    amountUnit: item.unit,
    savedFoodId: item.savedFoodId,
  };
}

function PortionField({ draft, onChange }: { draft: Draft; onChange: (next: Draft) => void }) {
  const amountUnitOptions =
    volumeMl[draft.unit] && draft.unit !== "ml"
      ? Object.keys(volumeMl).filter((unit) => unit !== draft.unit)
      : [];
  return (
    <div className="food-picker-portion">
      <label>
        <span>{draft.measureIn === "servings" ? "Servings eaten" : `Amount eaten`}</span>
        <input
          type="text"
          inputMode="decimal"
          value={draft.portion}
          onChange={(event) => onChange({ ...draft, portion: event.target.value })}
          placeholder={draft.measureIn === "servings" ? "½, 2/3, or 1" : "Amount"}
        />
      </label>
      <select
        aria-label={`Measure ${draft.name || "food"} eaten in`}
        value={draft.measureIn === "servings" ? "servings" : draft.amountUnit}
        onChange={(event) => {
          const next = event.target.value;
          onChange({
            ...draft,
            measureIn: next === "servings" ? "servings" : "amount",
            amountUnit: next === "servings" ? draft.amountUnit : next,
          });
        }}
      >
        <option value="servings">Servings</option>
        <option value={draft.unit}>{draft.unit || "units"}</option>
        {amountUnitOptions.map((unit) => (
          <option key={unit} value={unit}>
            {unit}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The label fields for a food: shared by "Add a new food" and editing a food in this meal. */
function FoodBasisInputs({
  fields,
  onChange,
}: {
  fields: FoodBasisFields;
  onChange: (next: FoodBasisFields) => void;
}) {
  return (
    <div className="food-picker-new-fields">
      <label className="field">
        <span>Name</span>
        <input
          value={fields.name}
          onChange={(event) => onChange({ ...fields, name: event.target.value })}
          placeholder="Food name"
        />
      </label>
      <label className="field">
        <span>Carbs per serving (g)</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={1000}
          step="any"
          value={fields.carbs}
          onChange={(event) => onChange({ ...fields, carbs: event.target.value })}
          placeholder="0"
        />
      </label>
      <label className="field">
        <span>Serving size</span>
        <input
          type="number"
          inputMode="decimal"
          min={0.01}
          step="any"
          value={fields.servingSize}
          onChange={(event) => onChange({ ...fields, servingSize: event.target.value })}
        />
      </label>
      <label className="field">
        <span>Unit</span>
        <input
          value={fields.unit}
          onChange={(event) => onChange({ ...fields, unit: event.target.value })}
          placeholder="cup, slice, piece"
        />
      </label>
    </div>
  );
}

export type FoodPickerProps = {
  savedFoods: SavedFood[];
  items: FoodItem[];
  onItemsChange: (items: FoodItem[]) => void;
  onSaveFood: (food: SavedFood) => Promise<boolean>;
  onDeleteFood: (food: SavedFood) => Promise<boolean>;
  recentFoods?: FoodItem[];
};

export function FoodPicker({
  savedFoods,
  items,
  onItemsChange,
  onSaveFood,
  onDeleteFood,
  recentFoods = [],
}: FoodPickerProps) {
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    items.map((item, i) => itemToDraft(item, `initial-${i}`)),
  );
  const [query, setQuery] = useState("");
  const [newFood, setNewFood] = useState({
    name: "",
    carbs: "",
    servingSize: "1",
    unit: "",
    save: true,
  });
  const [busyFoodId, setBusyFoodId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ key: string; fields: FoodBasisFields } | null>(null);
  const formId = useId();

  function commit(next: Draft[]) {
    setDrafts(next);
    onItemsChange(next.map(draftToItem));
  }

  function addDraft(basis: Omit<Draft, "key" | "portion" | "measureIn">) {
    commit([
      ...drafts,
      { ...basis, key: crypto.randomUUID(), portion: "1", measureIn: "servings" },
    ]);
  }

  function addSavedFood(food: SavedFood) {
    addDraft({
      name: food.name,
      unit: food.unit,
      servingSize: food.serving,
      carbsPerServing: food.carbs,
      amountUnit: food.unit,
      savedFoodId: food.id,
    });
  }

  function addRecentFood(item: FoodItem) {
    addDraft({
      name: item.name,
      unit: item.unit,
      servingSize: item.amount || 1,
      carbsPerServing: item.carbs,
      amountUnit: item.unit,
      savedFoodId: item.savedFoodId,
    });
  }

  async function submitNewFood(event: FormEvent) {
    event.preventDefault();
    const basis = parseFoodBasis(newFood);
    if (!basis) return;
    let savedFoodId: string | undefined;
    if (newFood.save) {
      const id = crypto.randomUUID();
      const saved = await onSaveFood({
        id,
        name: basis.name,
        carbs: basis.carbs,
        serving: basis.servingSize,
        unit: basis.unit,
      });
      if (saved) savedFoodId = id;
    }
    addDraft({
      name: basis.name,
      unit: basis.unit,
      servingSize: basis.servingSize,
      carbsPerServing: basis.carbs,
      amountUnit: basis.unit,
      savedFoodId,
    });
    setNewFood({ name: "", carbs: "", servingSize: "1", unit: "", save: true });
  }

  function startEdit(draft: Draft) {
    setEditing({
      key: draft.key,
      fields: {
        name: draft.name,
        carbs: String(draft.carbsPerServing),
        servingSize: String(draft.servingSize),
        unit: draft.unit,
      },
    });
  }

  /** Applies edited label values to one meal line; the portion eaten stays as typed. */
  function saveEdit(draft: Draft) {
    const basis = editing && parseFoodBasis(editing.fields);
    if (!basis) return;
    commit(
      drafts.map((d) =>
        d.key === draft.key
          ? {
              ...d,
              name: basis.name,
              unit: basis.unit,
              servingSize: basis.servingSize,
              carbsPerServing: basis.carbs,
              amountUnit: d.amountUnit === d.unit ? basis.unit : d.amountUnit,
            }
          : d,
      ),
    );
    setEditing(null);
  }

  async function saveDraftAsFavorite(draft: Draft) {
    setBusyFoodId(draft.key);
    const id = draft.savedFoodId ?? crypto.randomUUID();
    const saved = await onSaveFood({
      id,
      name: draft.name.trim() || "Unspecified food",
      carbs: draft.carbsPerServing,
      serving: draft.servingSize,
      unit: draft.unit,
    });
    if (saved) commit(drafts.map((d) => (d.key === draft.key ? { ...d, savedFoodId: id } : d)));
    setBusyFoodId(null);
  }

  async function deleteSavedFood(food: SavedFood) {
    setBusyFoodId(food.id);
    await onDeleteFood(food);
    setBusyFoodId(null);
  }

  const search = query.trim().toLowerCase();
  const matchingSaved = search
    ? savedFoods.filter((f) => f.name.toLowerCase().includes(search))
    : savedFoods;
  const matchingRecent = recentFoods.filter(
    (item) =>
      (!search || item.name.toLowerCase().includes(search)) &&
      !savedFoods.some((f) => f.id === item.savedFoodId),
  );
  const totalCarbs = drafts.reduce((sum, draft) => {
    const carbs = draftCarbs(draft);
    return sum + (Number.isFinite(carbs) ? carbs : 0);
  }, 0);

  return (
    <div className="food-picker">
      <label className="food-picker-search">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">Search saved and recent foods</span>
        <input
          type="search"
          placeholder="Search saved and recent foods…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          // The picker sits inside entry and calculator forms; Enter here must never submit them.
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
        />
      </label>

      {matchingSaved.length > 0 && (
        <div className="food-picker-section">
          <strong>Saved foods</strong>
          <div className="food-picker-chip-row">
            {matchingSaved.map((food) => (
              <span className="food-picker-chip" key={food.id}>
                <button type="button" onClick={() => addSavedFood(food)}>
                  {food.name}{" "}
                  <small>
                    {food.carbs} g / {food.serving} {food.unit}
                  </small>
                </button>
                <button
                  type="button"
                  className="food-picker-chip-remove"
                  aria-label={`Remove ${food.name} from saved foods`}
                  disabled={busyFoodId === food.id}
                  onClick={() => void deleteSavedFood(food)}
                >
                  <Trash2 size={13} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {matchingRecent.length > 0 && (
        <div className="food-picker-section">
          <strong>Recent</strong>
          <div className="food-picker-chip-row">
            {matchingRecent.map((item, i) => (
              <span className="food-picker-chip" key={`${item.name}-${i}`}>
                <button type="button" onClick={() => addRecentFood(item)}>
                  {item.name}{" "}
                  <small>
                    {fmt(item.carbs)} g / {fmt(item.amount)} {item.unit}
                  </small>
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {matchingSaved.length === 0 && matchingRecent.length === 0 && (
        <p className="food-picker-empty">
          {query.trim() ? "No saved or recent foods match." : "No saved foods yet."}
        </p>
      )}

      <form className="food-picker-new" onSubmit={(event) => void submitNewFood(event)}>
        <strong>Add a new food</strong>
        <FoodBasisInputs
          fields={newFood}
          onChange={(fields) => setNewFood({ ...newFood, ...fields })}
        />
        <label className="food-picker-save-toggle">
          <input
            type="checkbox"
            checked={newFood.save}
            onChange={(event) => setNewFood({ ...newFood, save: event.target.checked })}
          />
          Save for next time
        </label>
        <button type="submit" className="button outline" disabled={!parseFoodBasis(newFood)}>
          <Plus size={15} />
          Add this food
        </button>
      </form>

      {drafts.length > 0 && (
        <div className="food-picker-items">
          <strong>This meal</strong>
          {drafts.map((draft) => {
            const carbs = draftCarbs(draft);
            const edit = editing?.key === draft.key ? editing : null;
            const editValid = edit !== null && parseFoodBasis(edit.fields) !== null;
            return (
              <div className="food-picker-item" key={draft.key}>
                <div className="food-picker-item-title">
                  <strong>{draft.name || "Unspecified food"}</strong>
                  <button
                    type="button"
                    aria-label={`Remove ${draft.name || "food"}`}
                    onClick={() => commit(drafts.filter((d) => d.key !== draft.key))}
                  >
                    <X size={16} />
                  </button>
                </div>
                {edit ? (
                  <div className="food-picker-edit">
                    <FoodBasisInputs
                      fields={edit.fields}
                      onChange={(fields) => setEditing({ key: draft.key, fields })}
                    />
                    {!editValid && (
                      <p className="helper" role="status">
                        Enter a name, carbs, serving size and unit.
                      </p>
                    )}
                    <div className="food-picker-edit-actions">
                      <button
                        type="button"
                        className="button outline"
                        disabled={!editValid}
                        onClick={() => saveEdit(draft)}
                      >
                        Save changes
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <PortionField
                    draft={draft}
                    onChange={(next) => commit(drafts.map((d) => (d.key === draft.key ? next : d)))}
                  />
                )}
                <div className="food-picker-item-footer">
                  <small>
                    {Number.isFinite(carbs) ? fmt(carbs) : "—"} g carbs ·{" "}
                    {fmt(draft.carbsPerServing)} g per {fmt(draft.servingSize)} {draft.unit}
                  </small>
                  <div className="food-picker-item-actions">
                    {!edit && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => startEdit(draft)}
                      >
                        <Pencil size={13} aria-hidden="true" />
                        Edit food
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-button"
                      disabled={busyFoodId === draft.key || edit !== null}
                      onClick={() => void saveDraftAsFavorite(draft)}
                    >
                      <Star size={13} aria-hidden="true" />
                      {draft.savedFoodId ? "Update saved food" : "Save this food"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="food-picker-total" id={formId}>
            <span>Total carbohydrates</span>
            <strong>
              {fmt(totalCarbs)} <small>g</small>
            </strong>
          </div>
        </div>
      )}
    </div>
  );
}

export default FoodPicker;
