import { Notice } from "./Panel";

/**
 * Postgres is deliberately unpublished on the EMS host, so "can't connect" is the
 * expected first-run state on a dev machine. Say how to fix it rather than
 * printing a stack trace.
 */
export default function DbError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    <div className="pt-4">
      <Notice kind="error">
        <span>
          <strong className="font-medium text-foreground">Cannot reach Postgres.</strong>{" "}
          <code className="normal-case">{message}</code>
        </span>
      </Notice>

      <section className="bg-card border border-border rounded-lg p-4">
        <h2 className="text-[11px] font-medium text-muted-foreground tracking-wide mb-2">
          Getting connected
        </h2>
        <p className="text-[11.5px] leading-relaxed text-muted-foreground mb-3">
          Port 5432 is not published on 192.168.100.30 by design — the compose stack
          keeps the database on the internal ems-net bridge. Two steps to develop
          against real data:
        </p>
        <pre className="normal-case overflow-x-auto rounded-sm border border-border bg-secondary p-3 text-[11px] leading-relaxed text-muted-foreground">
{`# 1. On the EMS host, tunnel straight to the container's bridge IP
docker inspect ems-postgres --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'

# 2. From Windows
ssh -f -N -L 5432:<CONTAINER_IP>:5432 root@192.168.100.30

# 3. Set DATABASE_URL in ems-ui/.env.local
#    password: /opt/ems-edge-platform/secrets/db_password.txt`}
        </pre>
      </section>
    </div>
  );
}
