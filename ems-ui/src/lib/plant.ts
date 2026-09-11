import { cookies } from "next/headers";
import { listPlants, plantsWithDevices, type PlantInfo } from "./topology";

/** Cookie that holds the dashboard's selected plant. Also referenced (as a
    string literal) by the client PlantSelect, which can't import this file
    because it pulls in next/headers. */
export const PLANT_COOKIE = "ems_plant";

/**
 * The plant the dashboard is scoped to: the cookie's value if it's a real
 * plant, otherwise the first registered plant. Returns the plant list (for the
 * selector) and the selected plant's full config (tariff/contract/tz/tenant),
 * so pages read commercial constants from the plant, never from a hardcoded env.
 */
export async function getSelectedPlant(): Promise<{
  plant: string;
  plants: PlantInfo[];
  config: PlantInfo | null;
}> {
  const plants = await listPlants();
  const jar = await cookies();
  const wanted = jar.get(PLANT_COOKIE)?.value;

  let selected = plants.find((p) => p.id === wanted) ?? null;
  if (!selected) {
    // No (valid) cookie: prefer a plant that actually has devices/data over an
    // empty placeholder, so a first visit doesn't land on a blank plant.
    const withDevices = await plantsWithDevices();
    selected = plants.find((p) => withDevices.has(p.id)) ?? plants[0] ?? null;
  }
  return { plant: selected?.id ?? "", plants, config: selected };
}
