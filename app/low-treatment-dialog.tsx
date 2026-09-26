"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { toast } from "sonner";
import { entrySchema, type Entry, type FoodItem, type Plan, type SavedFood } from "@/lib/care";
import { CarePlanInstructions } from "./emergency-instructions";
import "./clinic-features.css";

const GRAMS_OPTION = "__grams__";

/** Records a low-treatment food entry: a saved fast-acting food marked `lowTreatment`, or a
 * typed gram amount, with a mild/moderate severity. Never recommends an amount. */
export default function LowTreatmentDialog({
  open,
  onOpenChange,
  plan,
  savedFoods,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: Plan;
  savedFoods: SavedFood[];
  onSave: (entry: Entry) => Promise<void>;
}) {
  const treatments = savedFoods.filter((food) => food.lowTreatment);
  const [choice, setChoice] = useState<string>(GRAMS_OPTION);
  const [grams, setGrams] = useState("");
  const [severity, setSeverity] = useState<"Mild" | "Moderate">("Mild");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setChoice(treatments[0]?.id ?? GRAMS_OPTION);
    setGrams("");
    setSeverity("Mild");
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const selectedFood =
    choice === GRAMS_OPTION ? null : (treatments.find((food) => food.id === choice) ?? null);
  const carbs = selectedFood ? selectedFood.carbs : Number(grams);
  const carbsValid = Number.isFinite(carbs) && carbs > 0;
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!carbsValid) {
      toast.error("Enter the grams of fast-acting carbs treated.");
      return;
    }
    const foodItems: FoodItem[] | undefined = selectedFood
      ? [
          {
            name: selectedFood.name,
            carbs: selectedFood.carbs,
            amount: selectedFood.serving,
            unit: selectedFood.unit,
            savedFoodId: selectedFood.id,
          },
        ]
      : undefined;
    try {
      const entry = entrySchema.parse({
        id: crypto.randomUUID(),
        kind: "food",
        // The recheck timer runs from this time, so take it when the treatment is recorded.
        at: new Date().toISOString(),
        glucose: null,
        source: null,
        ketones: null,
        carbs,
        foodItems,
        units: null,
        insulin: null,
        meal: "Low treatment",
        lowSeverity: severity,
        note: "",
      });
      setSaving(true);
      await onSave(entry);
      toast.success("Low treatment logged");
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error && err.message ? err.message : "Check the treatment amount.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!saving) onOpenChange(v);
      }}
    >
      <DialogContent className="care-dialog low-treatment-dialog">
        <DialogHeader>
          <DialogTitle>Log a low treatment</DialogTitle>
          <DialogDescription>
            Record what was given for a low glucose. This does not recommend an amount.
          </DialogDescription>
        </DialogHeader>
        {plan.lowTreatment && (
          <p className="notice" role="status">
            Your plan: up to {plan.lowTreatment.grams} g, recheck in{" "}
            {plan.lowTreatment.recheckMinutes} min
          </p>
        )}
        {plan.emergencyInstructions?.lowGlucose && (
          <CarePlanInstructions text={plan.emergencyInstructions.lowGlucose} />
        )}
        <form onSubmit={save} className="entry-form low-treatment-form">
          <label className="field">
            <span>Treatment</span>
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger className="choice" aria-label="Treatment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {treatments.map((food) => (
                  <SelectItem key={food.id} value={food.id}>
                    {food.name} · {food.carbs} g / {food.serving} {food.unit}
                  </SelectItem>
                ))}
                <SelectItem value={GRAMS_OPTION}>Type grams</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {choice === GRAMS_OPTION && (
            <label className="field">
              <span>Grams of fast-acting carbs</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={200}
                step="any"
                value={grams}
                onChange={(e) => setGrams(e.target.value)}
              />
            </label>
          )}
          <fieldset className="low-severity-toggle">
            <legend>Severity</legend>
            <div className="low-severity-options">
              {(["Mild", "Moderate"] as const).map((level) => (
                <button
                  type="button"
                  key={level}
                  aria-pressed={severity === level}
                  onClick={() => setSeverity(level)}
                >
                  {level}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="low-treatment-actions">
            <button
              type="button"
              className="button subtle"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="button primary full" disabled={saving}>
              {saving ? "Saving…" : "Save treatment"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
