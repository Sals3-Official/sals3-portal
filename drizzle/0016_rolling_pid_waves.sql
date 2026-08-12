UPDATE "discovery_pid_capacities"
SET
	"limit_value" = CASE
		WHEN "admitted_count" > 0 THEN "admitted_count"
		ELSE 600
	END,
	"cap_reached_at" = CASE
		WHEN "admitted_count" > 0 THEN COALESCE("cap_reached_at", now())
		ELSE "cap_reached_at"
	END,
	"updated_at" = now()
WHERE "limit_value" <> CASE
	WHEN "admitted_count" > 0 THEN "admitted_count"
	ELSE 600
END;
