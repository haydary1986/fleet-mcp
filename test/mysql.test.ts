import { describe, it, expect } from "vitest";
import { WRITE_RE } from "../src/tools/mysql.js";

describe("WRITE_RE (write/DDL detection)", () => {
  it("flags write and DDL statements", () => {
    for (const sql of [
      "INSERT INTO t VALUES (1)",
      "update t set a=1",
      "DELETE FROM t",
      "DROP TABLE t",
      "ALTER TABLE t ADD c INT",
      "TRUNCATE t",
      "GRANT ALL ON db.* TO u",
      "SET FOREIGN_KEY_CHECKS=0",
    ]) {
      expect(WRITE_RE.test(sql)).toBe(true);
    }
  });

  it("allows read-only statements", () => {
    for (const sql of [
      "SELECT * FROM users",
      "show tables",
      "DESCRIBE users",
      "EXPLAIN SELECT 1",
    ]) {
      expect(WRITE_RE.test(sql)).toBe(false);
    }
  });
});
