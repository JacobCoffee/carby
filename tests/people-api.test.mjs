import { mock } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTestDatabase, pgTest } from "./pg-test-helper.mjs";

// Whoever `signedIn` names is the account every route sees.
const accounts = {
  mom: { userId: "github:1", displayName: "Mom" },
  dad: { userId: "github:2", displayName: "Dad" },
  grandma: { userId: "google:3", displayName: "Grandma" },
  stranger: { userId: "discord:4", displayName: "Stranger" },
};
let signedIn = accounts.mom;
mock.module("@/app/auth", () => ({ getCurrentUser: async () => signedIn }));
mock.module("@/db/raw", () => ({ database: () => globalThis.peopleTestDb }));
const people = await import("../app/api/people/route.ts");
const care = await import("../app/api/care/route.ts");
const audit = await import("../app/api/audit/route.ts");
const summary = await import("../app/api/cgm/summary/route.ts");
const clarity = await import("../app/api/clarity/route.ts");
const clarityReport = await import("../app/api/clarity/report/route.ts");
const dexcom = await import("../app/api/dexcom/route.ts");
const exportRoute = await import("../app/api/export/route.ts");
const importRoute = await import("../app/api/import/route.ts");
const access = await import("../app/access.ts");

async function setup() {
  const db = await createTestDatabase();
  globalThis.peopleTestDb = db.database;
  signedIn = accounts.mom;
  return db;
}
async function teardown(db) {
  delete globalThis.peopleTestDb;
  await db.close();
}

const origin = "https://test.example";
function request(path, { method = "GET", person, body } = {}) {
  const headers = { Origin: origin };
  if (person) headers["x-carby-person"] = person;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const init =
    body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(body) };
  return new Request(`${origin}${path}`, init);
}
const json = async (pending) => {
  const response = await pending;
  return { status: response.status, body: await response.json() };
};
const peoplePost = (body, person) =>
  json(people.POST(request("/api/people", { method: "POST", person, body })));
const carePost = (body, person) =>
  care.POST(request("/api/care", { method: "POST", person, body }));

const plan = {
  target: 140,
  factor: 80,
  ratio: 40,
  increment: 0.5,
  rounding: "down",
  basal: 6,
  basalTime: "20:00",
  timezone: "America/Chicago",
  correctionHours: 4,
  note: "Synthetic plan",
  lowThreshold: 70,
  ketoneCheckAbove: 180,
  patternRule: { highDays: 3, lowDays: 2 },
};
const reading = (id, glucose) => ({
  id,
  kind: "glucose",
  at: "2026-09-25T17:00:00.000Z",
  glucose,
  source: "Finger-stick",
  ketones: "Not checked",
  carbs: null,
  units: null,
  insulin: null,
  meal: null,
  note: "",
});
const ids = {
  a: "11111111-1111-4111-8111-111111111111",
  b: "22222222-2222-4222-8222-222222222222",
  c: "33333333-3333-4333-8333-333333333333",
};

/** Mom's own person (her account id) with a plan and one reading; then an invite for `role`. */
async function momShares(role) {
  signedIn = accounts.mom;
  assert.equal((await carePost({ action: "plan", plan })).status, 200);
  assert.equal((await carePost({ action: "entry", entry: reading(ids.a, 110) })).status, 200);
  const invite = await peoplePost({ action: "invite", role });
  assert.equal(invite.status, 200);
  return new URL(invite.body.url).pathname.split("/").at(-1);
}
async function join(account, token) {
  signedIn = account;
  const joined = await peoplePost({ action: "accept", token });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  return joined.body.person;
}

pgTest(
  "an account that opened Carby before joining opens the shared log, not its empty person",
  async () => {
    const db = await setup();
    try {
      // Grandma's first visit gives her an owned person with no plan.
      signedIn = accounts.grandma;
      assert.equal((await json(people.GET(request("/api/people")))).status, 200);
      const person = await join(accounts.grandma, await momShares("caregiver"));
      const opened = (chosen) =>
        access.pagePeople(globalThis.peopleTestDb, accounts.grandma, chosen);
      // A browser without the person cookie, such as an iOS home screen app.
      assert.equal((await opened(undefined)).active.id, person);
      assert.equal((await opened(accounts.grandma.userId)).active.id, accounts.grandma.userId);
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "an account with records from before people existed keeps them as its own person",
  async () => {
    const db = await setup();
    try {
      await db.run(
        "INSERT INTO plans (id, owner, data, created) VALUES ($1, $2, $3, $4)",
        ids.a,
        accounts.mom.userId,
        JSON.stringify(plan),
        "2026-09-01T00:00:00.000Z",
      );
      // Rerun the migration's backfill, as a deploy does over existing rows.
      const migration = readFileSync(
        new URL("../postgres/0005_people.sql", import.meta.url),
        "utf8",
      );
      for (const statement of migration.split("--> statement-breakpoint").slice(-2))
        await db.run(statement);
      assert.deepEqual(await db.all("SELECT person, account, role FROM person_members"), [
        { person: accounts.mom.userId, account: accounts.mom.userId, role: "owner" },
      ]);
      const snapshot = await (await care.GET(request("/api/care"))).json();
      assert.deepEqual(snapshot.plan, plan);
    } finally {
      await teardown(db);
    }
  },
);

pgTest("a new account gets its own person, named by its account id", async () => {
  const db = await setup();
  try {
    const { body } = await json(people.GET(request("/api/people")));
    assert.equal(body.person, accounts.mom.userId);
    assert.equal(body.role, "owner");
    assert.deepEqual(
      body.members.map((m) => [m.name, m.role, m.you]),
      [["Mom", "owner", true]],
    );
    assert.equal((await carePost({ action: "plan", plan })).status, 200);
    assert.equal((await db.get("SELECT owner FROM plans")).owner, accounts.mom.userId);
  } finally {
    await teardown(db);
  }
});

pgTest(
  "a caregiver logs into the shared log under their own name but can't change the plan",
  async () => {
    const db = await setup();
    try {
      const person = await join(accounts.dad, await momShares("caregiver"));
      assert.equal(person, accounts.mom.userId);
      const snapshot = await (await care.GET(request("/api/care", { person }))).json();
      assert.deepEqual(
        snapshot.entries.map((e) => e.id),
        [ids.a],
      );

      assert.equal(
        (await carePost({ action: "entry", entry: reading(ids.b, 150) }, person)).status,
        200,
      );
      const logged = await db.get("SELECT owner FROM entries WHERE id = $1", ids.b);
      assert.equal(logged.owner, person);
      const history = await db.get(
        "SELECT actor_id, actor_name FROM care_audit WHERE entry_id = $1",
        ids.b,
      );
      assert.deepEqual(history, { actor_id: accounts.dad.userId, actor_name: "Dad" });

      const refused = await carePost({ action: "plan", plan: { ...plan, target: 120 } }, person);
      assert.equal(refused.status, 403);
      assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM plans")).n, 1);
      assert.equal((await json(exportRoute.GET(request("/api/export", { person })))).status, 403);
      assert.equal((await peoplePost({ action: "invite", role: "viewer" }, person)).status, 403);
    } finally {
      await teardown(db);
    }
  },
);

pgTest("a viewer sees the log but can't write anything", async () => {
  const db = await setup();
  try {
    const person = await join(accounts.grandma, await momShares("viewer"));
    assert.equal((await care.GET(request("/api/care", { person }))).status, 200);
    for (const body of [
      { action: "entry", entry: reading(ids.c, 90) },
      { action: "delete", id: ids.a },
      { action: "food", food: { id: ids.c, name: "Toast", carbs: 15, serving: 1, unit: "slice" } },
    ])
      assert.equal((await carePost(body, person)).status, 403, body.action);
    assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM entries")).n, 1);
    assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM saved_foods")).n, 0);
  } finally {
    await teardown(db);
  }
});

pgTest("someone who isn't a member gets 404 from every care route for that person", async () => {
  const db = await setup();
  try {
    await momShares("caregiver");
    const person = accounts.mom.userId;
    signedIn = accounts.stranger;
    const attempts = {
      "GET care": care.GET(request("/api/care", { person })),
      "POST care": carePost({ action: "entry", entry: reading(ids.c, 90) }, person),
      "GET audit": audit.GET(request("/api/audit", { person })),
      "GET summary": summary.GET(
        request("/api/cgm/summary?start=2026-09-01&end=2026-09-02", { person }),
      ),
      "GET clarity": clarity.GET(request("/api/clarity", { person })),
      "POST clarity": clarity.POST(
        request("/api/clarity", { method: "POST", person, body: { action: "sync" } }),
      ),
      "DELETE clarity": clarity.DELETE(request("/api/clarity", { method: "DELETE", person })),
      "GET report": clarityReport.GET(request(`/api/clarity/report?id=${ids.a}`, { person })),
      "DELETE report": clarityReport.DELETE(
        request(`/api/clarity/report?id=${ids.a}`, { method: "DELETE", person }),
      ),
      "GET dexcom": dexcom.GET(request("/api/dexcom", { person })),
      "POST dexcom": dexcom.POST(
        request("/api/dexcom", { method: "POST", person, body: { action: "sync" } }),
      ),
      "DELETE dexcom": dexcom.DELETE(request("/api/dexcom", { method: "DELETE", person })),
      "GET export": exportRoute.GET(request(`/api/export?person=${encodeURIComponent(person)}`)),
      "GET import": importRoute.GET(request("/api/import", { person })),
      "POST import": importRoute.POST(
        request("/api/import", { method: "POST", person, body: { action: "cleanup" } }),
      ),
      "GET people": people.GET(request("/api/people", { person })),
      switch: peoplePost({ action: "switch", person }),
    };
    for (const [label, pending] of Object.entries(attempts)) {
      const response = await pending;
      assert.equal(response.status, 404, label);
    }
    assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM entries")).n, 1);
  } finally {
    await teardown(db);
  }
});

pgTest("an invite works once and expires", async () => {
  const db = await setup();
  try {
    const token = await momShares("caregiver");
    await join(accounts.dad, token);
    signedIn = accounts.grandma;
    assert.equal((await peoplePost({ action: "accept", token })).status, 410);

    signedIn = accounts.mom;
    const second = await peoplePost({ action: "invite", role: "viewer" });
    await db.run(
      "UPDATE person_invites SET expires = $1 WHERE id = $2",
      "2026-01-01T00:00:00.000Z",
      second.body.invite.id,
    );
    signedIn = accounts.grandma;
    const late = await peoplePost({
      action: "accept",
      token: new URL(second.body.url).pathname.split("/").at(-1),
    });
    assert.equal(late.status, 410);
    assert.equal(
      (
        await db.get(
          "SELECT COUNT(*)::int AS n FROM person_members WHERE account = $1",
          accounts.grandma.userId,
        )
      ).n,
      0,
    );
  } finally {
    await teardown(db);
  }
});

pgTest("every person keeps an owner, and removal takes access away", async () => {
  const db = await setup();
  try {
    const person = await join(accounts.dad, await momShares("caregiver"));
    signedIn = accounts.mom;
    assert.equal((await peoplePost({ action: "leave" })).status, 400);
    assert.equal(
      (await peoplePost({ action: "setRole", account: accounts.dad.userId, role: "owner" })).status,
      200,
    );
    // Now Dad is an owner too, so Mom may step down, and Dad may remove her.
    signedIn = accounts.dad;
    assert.equal(
      (
        await peoplePost(
          { action: "setRole", account: accounts.mom.userId, role: "viewer" },
          person,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await peoplePost(
          { action: "setRole", account: accounts.dad.userId, role: "viewer" },
          person,
        )
      ).status,
      400,
    );
    assert.equal(
      (await peoplePost({ action: "removeMember", account: accounts.mom.userId }, person)).status,
      200,
    );
    signedIn = accounts.mom;
    // Mom keeps an account; with no people left she gets a fresh one, never her old access back.
    const after = (await json(people.GET(request("/api/people")))).body;
    assert.notEqual(after.person, person);
    assert.equal((await care.GET(request("/api/care", { person }))).status, 404);
    const actions = (
      await db.all("SELECT action FROM care_audit WHERE owner = $1 ORDER BY at", person)
    ).map((row) => row.action);
    assert.ok(actions.includes("access granted"));
    assert.ok(actions.includes("access removed"));
  } finally {
    await teardown(db);
  }
});

pgTest("with two people, a write must say whose log it is for", async () => {
  const db = await setup();
  try {
    await carePost({ action: "plan", plan });
    const created = await peoplePost({ action: "create" });
    assert.equal(created.status, 200);
    const second = created.body.person;
    assert.notEqual(second, accounts.mom.userId);
    // Unnamed writes are ambiguous now; named ones go exactly where they say.
    assert.equal((await carePost({ action: "plan", plan })).status, 409);
    assert.equal(
      (await carePost({ action: "plan", plan: { ...plan, target: 110 } }, second)).status,
      200,
    );
    const owners = await db.all("SELECT owner, data FROM plans ORDER BY created");
    assert.deepEqual(
      owners.map((row) => [row.owner, JSON.parse(row.data).target]),
      [
        [accounts.mom.userId, 140],
        [second, 110],
      ],
    );
    // Reads without a name follow the switch cookie.
    const cookieRead = new Request(`${origin}/api/care`, {
      headers: { Cookie: `carby_person=${second}` },
    });
    assert.equal((await (await care.GET(cookieRead)).json()).plan.target, 110);
  } finally {
    await teardown(db);
  }
});

pgTest("an owner who is removed can't come back through an invite they made earlier", async () => {
  const db = await setup();
  try {
    const person = await join(accounts.dad, await momShares("caregiver"));
    signedIn = accounts.mom;
    await peoplePost({ action: "setRole", account: accounts.dad.userId, role: "owner" });
    const kept = await peoplePost({ action: "invite", role: "owner" });
    const token = new URL(kept.body.url).pathname.split("/").at(-1);
    signedIn = accounts.dad;
    assert.equal(
      (await peoplePost({ action: "removeMember", account: accounts.mom.userId }, person)).status,
      200,
    );
    assert.equal(
      (
        await db.get(
          "SELECT COUNT(*)::int AS n FROM person_invites WHERE created_by = $1 AND accepted_at IS NULL",
          accounts.mom.userId,
        )
      ).n,
      0,
    );
    signedIn = accounts.mom;
    assert.equal((await peoplePost({ action: "accept", token })).status, 410);
    assert.equal(
      await db.get(
        "SELECT role FROM person_members WHERE person = $1 AND account = $2",
        person,
        accounts.mom.userId,
      ),
      null,
    );
  } finally {
    await teardown(db);
  }
});

pgTest("history records only sharing changes that happened", async () => {
  const db = await setup();
  try {
    await momShares("caregiver");
    const before = (await db.get("SELECT COUNT(*)::int AS n FROM care_audit")).n;
    const gone = await peoplePost({ action: "revokeInvite", id: ids.c });
    assert.equal(gone.status, 404);
    assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM care_audit")).n, before);
  } finally {
    await teardown(db);
  }
});

pgTest("two first visits at once after losing every person create one new person", async () => {
  const db = await setup();
  try {
    const person = await join(accounts.dad, await momShares("caregiver"));
    signedIn = accounts.mom;
    await peoplePost({ action: "setRole", account: accounts.dad.userId, role: "owner" });
    signedIn = accounts.dad;
    await peoplePost({ action: "removeMember", account: accounts.mom.userId }, person);
    signedIn = accounts.mom;
    const [a, b] = await Promise.all([
      json(people.GET(request("/api/people"))),
      json(people.GET(request("/api/people"))),
    ]);
    assert.equal(a.body.person, b.body.person);
    assert.notEqual(a.body.person, person);
    assert.equal(
      (
        await db.get(
          "SELECT COUNT(*)::int AS n FROM person_members WHERE account = $1",
          accounts.mom.userId,
        )
      ).n,
      1,
    );
  } finally {
    await teardown(db);
  }
});
