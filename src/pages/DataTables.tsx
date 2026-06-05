import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AbilitiesDataTable from "./data-tables/AbilitiesDataTable";
import BiogramsDataTable from "./data-tables/BiogramsDataTable";
import CharmsDataTable from "./data-tables/CharmsDataTable";
import EffectsDataTable from "./data-tables/EffectsDataTable";
import ItemsDataTable from "./data-tables/ItemsDataTable";

const TABLES = [
  { id: "abilities", label: "Abilities" },
  { id: "biograms", label: "Biograms" },
  { id: "charms", label: "Charms" },
  { id: "effects", label: "Effects" },
  { id: "items", label: "Items" },
] as const;

type TableId = (typeof TABLES)[number]["id"];

export default function DataTables() {
  const [active, setActive] = useState<TableId>(TABLES[0].id);

  return (
    <Tabs
      value={active}
      onValueChange={(v) => setActive(v as TableId)}
      className="flex h-full min-h-0 flex-col gap-4"
    >
      <TabsList className="w-full">
        {TABLES.map(({ id, label }) => (
          <TabsTrigger key={id} value={id}>
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="abilities" className="min-h-0">
        <AbilitiesDataTable />
      </TabsContent>
      <TabsContent value="biograms" className="min-h-0">
        <BiogramsDataTable />
      </TabsContent>
      <TabsContent value="charms" className="min-h-0">
        <CharmsDataTable />
      </TabsContent>
      <TabsContent value="effects" className="min-h-0">
        <EffectsDataTable />
      </TabsContent>
      <TabsContent value="items" className="min-h-0">
        <ItemsDataTable />
      </TabsContent>
    </Tabs>
  );
}
