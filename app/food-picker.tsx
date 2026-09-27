"use client";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import {
  Loader2,
  Pencil,
  Plus,
  ScanBarcode,
  ScanText,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type { FoodItem, SavedFood } from "@/lib/care";
import {
  FOOD_QUERY_MIN,
  foodLookupResultSchema,
  foodSourceLabels,
  type FoodLookupResult,
  type FoodMatch,
  type FoodServing,
} from "@/lib/food-lookup";
import { apiFetch } from "@/lib/person-request";
import {
  amountEaten,
  amountInServingUnits,
  parseFoodBasis,
  volumeMl,
  type FoodBasisFields,
  type Portioned,
} from "@/lib/portions";
import BarcodeScanner from "./barcode-scanner";
import LabelReader, { type LabelFill } from "./label-reader";
import "./food-picker.css";

const fmt = (n: number) => Number(n.toFixed(2)).toString();

type Lookup =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "error"; message: string }
  | { status: "done"; barcode: boolean; result: FoodLookupResult };

const LOOKUP_FAILED = "Food lookup isn’t available right now. Enter the label values below.";

/** Anything typed as digits is a barcode; the server checks it is a real one. */
const isBarcode = (value: string) => /^[\d\s-]+$/.test(value.trim());

/** The brand leads the name, so "Original Potato Crisps" is saved as "Pringles Original Potato Crisps". */
function matchName(match: FoodMatch): string {
  const { name, brand } = match;
  if (!brand || name.toLowerCase().includes(brand.toLowerCase())) return name;
  return `${brand} ${name}`.slice(0, 100).trim();
}

function lookupNotice(lookup: Extract<Lookup, { status: "done" }>): string | null {
  const { matches, unavailable } = lookup.result;
  if (unavailable.length) {
    const names = unavailable.map((s) => foodSourceLabels[s]).join(" or ");
    return matches.length
      ? `Couldn’t reach ${names}.`
      : `Couldn’t reach ${names}, so it may still list this food. Try again, or enter the label values below.`;
  }
  if (matches.length) return null;
  return lookup.barcode
    ? "No product found for this barcode. Enter the label values below."
    : "No foods with carbs found. Try other words, or enter the label values below.";
}

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

function draftPortion(draft: Draft): Portioned {
  return {
    servings: draft.portion,
    servingSize: String(draft.servingSize),
    unit: draft.unit,
    amountUnit: draft.measureIn === "servings" ? draft.unit : draft.amountUnit,
    byServing: draft.measureIn === "servings",
  };
}

function draftCarbs(draft: Draft): number {
  const amount = amountInServingUnits(draftPortion(draft));
  return Number.isFinite(amount) ? (draft.carbsPerServing / draft.servingSize) * amount : NaN;
}

function draftToItem(draft: Draft): FoodItem {
  const carbs = draftCarbs(draft);
  // Recorded in the unit it was measured in, so the item's carbs are for that amount of that unit.
  const amount = amountEaten(draftPortion(draft));
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

/**
 * The label fields for a food: shared by "Add a new food" and editing a food in this meal.
 * The picker sits inside entry and calculator forms, so these fields are not a form of their
 * own (a nested form submits as a page load); Enter runs `onEnter` instead of submitting.
 */
function FoodBasisInputs({
  fields,
  onChange,
  onEnter,
}: {
  fields: FoodBasisFields;
  onChange: (next: FoodBasisFields) => void;
  onEnter: () => void;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onEnter();
  };
  return (
    <div className="food-picker-new-fields">
      <label className="field">
        <span>Name</span>
        <input
          value={fields.name}
          onChange={(event) => onChange({ ...fields, name: event.target.value })}
          placeholder="Food name"
          onKeyDown={onKeyDown}
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
          onKeyDown={onKeyDown}
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
          onKeyDown={onKeyDown}
        />
      </label>
      <label className="field">
        <span>Unit</span>
        <input
          value={fields.unit}
          onChange={(event) => onChange({ ...fields, unit: event.target.value })}
          placeholder="cup, slice, piece"
          onKeyDown={onKeyDown}
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
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });
  /** Says where the new-food fields were filled from, until the food is added. */
  const [filledFrom, setFilledFrom] = useState<{ note: string; uncertain: boolean } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const lookupId = useRef(0);
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

  async function addNewFood() {
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
    setFilledFrom(null);
  }

  async function lookUp(input: string) {
    const value = input.trim();
    const barcode = isBarcode(value);
    if (!barcode && value.length < FOOD_QUERY_MIN) return;
    const id = ++lookupId.current;
    setLookup({ status: "busy" });
    let next: Lookup;
    try {
      const params = new URLSearchParams(barcode ? { barcode: value } : { q: value });
      const response = await apiFetch(`/api/foods?${params}`);
      const json: unknown = await response.json().catch(() => null);
      const error = (json as { error?: unknown } | null)?.error;
      const parsed = foodLookupResultSchema.safeParse(json);
      next = parsed.success
        ? { status: "done", barcode, result: parsed.data }
        : { status: "error", message: typeof error === "string" ? error : LOOKUP_FAILED };
    } catch {
      next = { status: "error", message: LOOKUP_FAILED };
    }
    // A newer lookup started meanwhile; its answer is the one to show.
    if (id === lookupId.current) setLookup(next);
  }

  /** Fills the new-food fields for checking; nothing is added until "Add this food". */
  function fillFromMatch(match: FoodMatch, serving: FoodServing | null) {
    setNewFood({
      ...newFood,
      name: matchName(match),
      carbs: serving ? String(serving.carbs) : "",
      servingSize: serving ? String(serving.servingSize) : "1",
      unit: serving?.unit ?? "",
    });
    setFilledFrom({
      note: `Filled in from ${foodSourceLabels[match.source]}. Check each value against the package label before adding.`,
      uncertain: false,
    });
    lookupId.current++;
    setLookup({ status: "idle" });
  }

  function scanned(gtin: string) {
    setScanning(false);
    setLookupQuery(gtin);
    void lookUp(gtin);
  }

  function closePhoto() {
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
  }

  /** The name stays as typed: a label photo gives the numbers, not what the food is called. */
  function fillFromLabel({ carbs, serving, uncertain }: LabelFill) {
    setNewFood({
      ...newFood,
      carbs: String(carbs),
      ...(serving ? { servingSize: String(serving.servingSize), unit: serving.unit } : {}),
    });
    setFilledFrom({
      note: !serving
        ? "Carbs filled in from the label photo. Enter the serving size they are for, and check both against the label before adding."
        : uncertain
          ? "Filled in from the label photo, but some values were hard to read. Check each value against the label before adding."
          : "Filled in from the label photo. Check each value against the label before adding.",
      uncertain,
    });
    closePhoto();
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

      <div className="food-picker-new">
        <strong>Add a new food</strong>
        <div className="food-picker-lookup">
          <label className="food-picker-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Look up a food by name or barcode</span>
            <input
              type="search"
              placeholder="Look up by name or barcode…"
              value={lookupQuery}
              onChange={(event) => setLookupQuery(event.target.value)}
              // Inside entry and calculator forms: Enter looks up and never submits them.
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void lookUp(lookupQuery);
              }}
            />
          </label>
          <div className="food-picker-lookup-actions">
            <button
              type="button"
              className="button outline"
              disabled={
                lookup.status === "busy" ||
                (!isBarcode(lookupQuery) && lookupQuery.trim().length < FOOD_QUERY_MIN)
              }
              onClick={() => void lookUp(lookupQuery)}
            >
              {lookup.status === "busy" ? (
                <>
                  <Loader2 size={15} className="spin" aria-hidden="true" />
                  Looking up…
                </>
              ) : (
                "Look up"
              )}
            </button>
            <button type="button" className="button outline" onClick={() => setScanning(true)}>
              <ScanBarcode size={15} aria-hidden="true" />
              Scan barcode
            </button>
            <button
              type="button"
              className="button outline"
              onClick={() => photoInput.current?.click()}
            >
              <ScanText size={15} aria-hidden="true" />
              Photo of label
            </button>
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              hidden
              aria-label="Photo of a nutrition label"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Cleared so choosing the same photo again still reads it.
                event.target.value = "";
                if (!file) return;
                if (photo) URL.revokeObjectURL(photo.url);
                setPhoto({ file, url: URL.createObjectURL(file) });
              }}
            />
          </div>
        </div>
        {lookup.status === "error" && (
          <p className="helper" role="status">
            {lookup.message}
          </p>
        )}
        {lookup.status === "done" && (
          <div className="food-picker-results">
            {lookup.result.matches.map((match) => (
              <div className="food-picker-result" key={`${match.source}-${match.id}`}>
                <span>
                  <strong>{match.name}</strong>{" "}
                  <small>
                    {[match.brand, foodSourceLabels[match.source]].filter(Boolean).join(" · ")}
                  </small>
                </span>
                <div className="food-picker-chip-row">
                  {match.servings.length ? (
                    match.servings.map((serving) => (
                      <span className="food-picker-chip" key={serving.label}>
                        <button type="button" onClick={() => fillFromMatch(match, serving)}>
                          {fmt(serving.carbs)} g carbs <small>per {serving.label}</small>
                        </button>
                      </span>
                    ))
                  ) : (
                    <span className="food-picker-chip">
                      <button type="button" onClick={() => fillFromMatch(match, null)}>
                        Use this name <small>no carbs listed</small>
                      </button>
                    </span>
                  )}
                </div>
              </div>
            ))}
            {lookupNotice(lookup) && (
              <p className="food-picker-empty" role="status">
                {lookupNotice(lookup)}
              </p>
            )}
          </div>
        )}
        {filledFrom && (
          <p
            className={`helper food-picker-source${filledFrom.uncertain ? " is-uncertain" : ""}`}
            role="status"
          >
            {filledFrom.note}
          </p>
        )}
        <FoodBasisInputs
          fields={newFood}
          onChange={(fields) => setNewFood({ ...newFood, ...fields })}
          onEnter={() => void addNewFood()}
        />
        <BarcodeScanner open={scanning} onOpenChange={setScanning} onDetected={scanned} />
        <LabelReader
          photo={photo}
          onClose={closePhoto}
          onUse={fillFromLabel}
          onRetake={() => photoInput.current?.click()}
        />
        <label className="food-picker-save-toggle">
          <input
            type="checkbox"
            checked={newFood.save}
            onChange={(event) => setNewFood({ ...newFood, save: event.target.checked })}
          />
          Save for next time
        </label>
        <button
          type="button"
          className="button outline"
          disabled={!parseFoodBasis(newFood)}
          onClick={() => void addNewFood()}
        >
          <Plus size={15} />
          Add this food
        </button>
      </div>

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
                      onEnter={() => saveEdit(draft)}
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
