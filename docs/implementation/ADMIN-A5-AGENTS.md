# Admin A5 — Agents

`/admin/agents` is built from real `AgentProfile` records. It provides bounded search over Agent name/email, agency profile name, and compliance code; active/inactive profile filtering; pagination; total/active agents; live listing count; and verified-deal totals.

`/admin/agents/[agentId]` shows safe identity, the existing AgentProfile fields, compliance code, account/profile state, subscription tier/status/listing limit where present, a bounded property summary, recent governance events, and rating/deal aggregates. It does not impersonate an Agent or expose an Agent mutation workflow.

The account state is still governed through the user account operation. The separate `AgentProfile.active` field is displayed as operational profile state and is not treated as an invented verification or compliance approval state.
