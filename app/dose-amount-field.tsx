"use client";
import { useId } from "react";
import { doseAmount, stepDose } from "@/lib/dose-adjustment";

export default function DoseAmountField({
  label,
  value,
  onChange,
  increment,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  increment: number;
  disabled?: boolean;
}) {
  const id = useId();
  const amount = doseAmount(value);
  return (
    <div className="dose-amount-field">
      <label htmlFor={id}>{label}</label>
      <div className="dose-stepper">
        <button
          type="button"
          className="button outline"
          aria-label={`Decrease by ${increment} units`}
          disabled={disabled || amount === null || amount <= 0}
          onClick={() => onChange(stepDose(value, -1, increment))}
        >
          −{increment}
        </button>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={value}
          min={0}
          max={100}
          step="any"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="button outline"
          aria-label={`Increase by ${increment} units`}
          disabled={disabled || amount === null || amount >= 100}
          onClick={() => onChange(stepDose(value, 1, increment))}
        >
          +{increment}
        </button>
      </div>
      <span className="sr-only" role="status">
        {amount === null ? "Enter an amount" : `${amount} units selected`}
      </span>
    </div>
  );
}
