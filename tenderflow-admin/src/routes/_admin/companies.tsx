import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/admin/PageHeader";
import { Building2, MapPin, BadgeCheck } from "lucide-react";

export const Route = createFileRoute("/_admin/companies")({
  component: Companies,
});

const companies = [
  { name: "ООО «Рассвет»", inn: "7701234567", city: "Москва", tenders: 24, verified: true },
  { name: "СК «СтройМаш»", inn: "7812345678", city: "Санкт-Петербург", tenders: 18, verified: true },
  { name: "TechFlow Ltd.", inn: "7723456789", city: "Москва", tenders: 32, verified: true },
  { name: "МедПром", inn: "5034567890", city: "Подольск", tenders: 9, verified: false },
  { name: "ЧистоПлюс", inn: "7745678901", city: "Москва", tenders: 12, verified: true },
  { name: "АльфаКонсалт", inn: "7856789012", city: "Казань", tenders: 7, verified: false },
];

function Companies() {
  return (
    <>
      <PageHeader title="Компании" description="Реестр зарегистрированных организаций" />
      <div className="p-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {companies.map((c) => (
            <div
              key={c.inn}
              className="rounded-xl border border-border bg-card p-5 transition hover:border-primary/40"
              style={{ boxShadow: "var(--shadow-sm)" }}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Building2 className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h3 className="truncate font-semibold text-foreground">{c.name}</h3>
                    {c.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-primary" />}
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">ИНН {c.inn}</p>
                  <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" /> {c.city}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                <div>
                  <p className="text-xs text-muted-foreground">Участие в тендерах</p>
                  <p className="text-lg font-bold text-foreground">{c.tenders}</p>
                </div>
                <button className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent">
                  Подробнее
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
