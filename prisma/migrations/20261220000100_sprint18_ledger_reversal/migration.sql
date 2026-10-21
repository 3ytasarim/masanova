-- Sprint 18 (2/2): REVERSAL enum değeri ayrı işlemde eklendikten SONRA kullanılabilir.
-- REDEEM: siparişe bağlı ve eksi puan; REVERSAL: siparişe değil geri aldığı satıra bağlı (tek kez — benzersiz).
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_kind_check" CHECK (
  ("type" <> 'REDEEM' OR ("order_id" IS NOT NULL AND "points" < 0 AND "reward_id" IS NOT NULL))
  AND ("type" <> 'REVERSAL' OR ("reverses_entry_id" IS NOT NULL AND "order_id" IS NULL))
  AND ("type" = 'REVERSAL' OR "reverses_entry_id" IS NULL)
);

-- Geri alma satırı: aynı hesap, aynı kiracı, puan tam ters işaretli; yalnızca EARN / REDEEM geri alınır.
CREATE OR REPLACE FUNCTION loyalty_ledger_reversal_check() RETURNS trigger AS $$
DECLARE original RECORD;
BEGIN
  IF NEW.type = 'REVERSAL' THEN
    SELECT account_id, tenant_id, points, type INTO original FROM loyalty_ledger WHERE id = NEW.reverses_entry_id;
    IF NOT FOUND OR original.account_id <> NEW.account_id OR original.tenant_id <> NEW.tenant_id OR original.points <> -NEW.points OR original.type NOT IN ('EARN', 'REDEEM') THEN
      RAISE EXCEPTION 'loyalty_ledger: invalid reversal' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER loyalty_ledger_reversal BEFORE INSERT ON loyalty_ledger FOR EACH ROW EXECUTE FUNCTION loyalty_ledger_reversal_check();
