// printer-client/scripts/seed-fake-job.ts
import { supabase } from "../src/supabase";

async function main() {
  const rand = Math.random().toString(36).slice(2, 10);
  const { data, error } = await supabase.from("print_jobs").insert({
    square_order_id: `fake-${rand}`,
    source: "pos",
    sticker_number: "TA99",
    order_total_cents: 700,
    cups: [
      {
        drinkName: "Brown Sugar Milk Tea",
        toppings: ["Pearls"],
        ice: "Less Ice",
        sugar: "Half Sugar",
        priceCents: 700,
      },
    ],
  }).select().single();
  if (error) throw error;
  console.log("[seed] inserted fake print_job", data?.id);
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
