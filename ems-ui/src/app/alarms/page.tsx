import LiveHeader from "@/components/LiveHeader";
import StatTile from "@/components/StatTile";
import { Panel } from "@/components/Panel";
import DbError from "@/components/DbError";
import EmptyPlant from "@/components/EmptyPlant";
import { getTopology } from "@/lib/topology";
import { getSelectedPlant } from "@/lib/plant";
import { alarmSnapshots } from "@/lib/queries";
import { ALARM_LIMITS, alarmSummary, evaluateAlarms, type Alarm } from "@/lib/alarms";
import { CircleCheck, TriangleAlert } from "lucide-react";

export const dynamic = "force-dynamic";

function AlarmRow({ a }: { a: Alarm }) {
  const color = a.severity === "crit" ? "var(--bad)" : "var(--warn)";
  return (
    <div className="grid grid-cols-[16px_92px_1fr] items-start gap-3 border-b border-border py-2.5 last:border-b-0">
      <TriangleAlert size={13} strokeWidth={2} style={{ color, marginTop: 1 }} />
      <span className="truncate text-[12px] font-medium text-foreground">{a.deviceId}</span>
      <span className="text-[12px] text-foreground">
        {a.message}
        {a.detail && <span className="ml-2 text-[10.5px] text-muted-foreground">({a.detail})</span>}
        <span className="ml-2 rounded-[3px] px-1.5 py-0.5 text-[9px] uppercase tracking-wide" style={{ color, border: `1px solid ${color}` }}>
          {a.severity}
        </span>
      </span>
    </div>
  );
}

export default async function AlarmsPage() {
  try {
    const { plant, config } = await getSelectedPlant();
    const topo = await getTopology(plant);

    if (topo.allIds.length === 0) {
      return (
        <>
          <LiveHeader title="Alarms" />
          <EmptyPlant plantName={config?.name} />
        </>
      );
    }

    const snaps = await alarmSnapshots(plant, topo.pollableIds);
    const alarms = evaluateAlarms(snaps);
    const sum = alarmSummary(alarms);

    return (
      <>
        <LiveHeader title="Alarms" />

        <div className="grid grid-cols-12 gap-3 pb-4">
          <StatTile
            label="Critical"
            value={String(sum.crit)}
            tone={sum.crit > 0 ? "crit" : "good"}
            status={sum.crit > 0 ? "Needs attention" : "None"}
            sub="Offline / no valid data"
          />
          <StatTile
            label="Warnings"
            value={String(sum.warn)}
            tone={sum.warn > 0 ? "warn" : "good"}
            status={sum.warn > 0 ? "Review" : "None"}
            sub="PF · voltage · frequency · THD"
          />
          <StatTile
            label="Meters monitored"
            value={String(topo.pollableIds.length)}
            sub="Real (non-virtual) meters in this plant"
          />
          <StatTile
            label="Evaluation"
            value="Live"
            sub="Current state, re-checked every 30s"
          />

          <Panel title="Active alarms" span="col-span-12">
            {alarms.length === 0 ? (
              <div className="flex items-center gap-2.5 py-2 text-[12.5px] text-foreground">
                <CircleCheck size={16} strokeWidth={2} style={{ color: "var(--good)" }} />
                All clear — no active alarms across {topo.pollableIds.length}{" "}
                {topo.pollableIds.length === 1 ? "meter" : "meters"}.
              </div>
            ) : (
              alarms.map((a) => <AlarmRow key={a.id} a={a} />)
            )}
          </Panel>

          <Panel title="Thresholds" span="col-span-12">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Standard defaults, applied live per meter (no history is stored yet — this
              is current state only). Offline after{" "}
              <b className="text-foreground">{ALARM_LIMITS.offlineSeconds}s</b> without data;
              power factor below <b className="text-foreground">{ALARM_LIMITS.pfMin}</b>;
              voltage outside{" "}
              <b className="text-foreground">
                {ALARM_LIMITS.voltageMin}–{ALARM_LIMITS.voltageMax} V
              </b>
              ; frequency outside{" "}
              <b className="text-foreground">
                {ALARM_LIMITS.freqMin}–{ALARM_LIMITS.freqMax} Hz
              </b>
              ; voltage THD above{" "}
              <b className="text-foreground">{ALARM_LIMITS.voltageThdMax}%</b>. Current THD is
              intentionally not alarmed — %-THD runs high at part load and its real limit is
              load-dependent, so it stays a diagnostic on the Power Quality page. Demand-vs-contract
              alarms activate once a plant&apos;s sanctioned demand is entered.
            </p>
          </Panel>
        </div>
      </>
    );
  } catch (err) {
    return <DbError error={err} />;
  }
}
