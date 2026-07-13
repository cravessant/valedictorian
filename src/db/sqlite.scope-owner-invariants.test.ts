import { describe, expect, it } from 'vitest'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from './sqlite'
import { createSqliteConnectorRepository } from '../modules/connectors/connector.repository'

describe('source execution scope ownership invariants', () => {
  it('rejects connector runs, occurrences, and retry ownership bound to a wrong existing scope', async () => {
    const sqlite = createInMemoryDatabase(); migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    const one = await repository.upsertInstance({ id: 'one', connectorId: 'fixture', connectorVersion: '1', displayName: 'One', enabled: true })
    const two = await repository.upsertInstance({ id: 'two', connectorId: 'fixture', connectorVersion: '1', displayName: 'Two', enabled: true })
    const runValues = `'run-one','${one.executionScopeId}','one','manual','queued','2026-07-12T00:00:00.000Z','{}','{}','filters:{}',0,0,'{}','[]','null','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z'`
    expect(() => sqlite.exec(`insert into connector_runs (id,execution_scope_id,connector_instance_id,mode,status,started_at,config_json,filters_json,filter_signature,observation_count,warning_count,stats_json,warnings_json,retry_hints_json,created_at,updated_at) values (${runValues.replace(one.executionScopeId, two.executionScopeId)})`))
      .toThrow(/scope owner mismatch/)
    sqlite.exec(`insert into connector_runs (id,execution_scope_id,connector_instance_id,mode,status,started_at,config_json,filters_json,filter_signature,observation_count,warning_count,stats_json,warnings_json,retry_hints_json,created_at,updated_at) values (${runValues})`)
    expect(() => sqlite.exec(`update connector_runs set execution_scope_id='${two.executionScopeId}' where id='run-one'`)).toThrow(/scope owner mismatch/)
    sqlite.exec(`insert into raw_source_records (id,created_at) values ('record','2026-07-12T00:00:00.000Z'); insert into raw_source_revisions (id,raw_record_id,revision,content_hash,adapter_id,adapter_kind,adapter_version,observed_at,evidence_json,created_at) values ('revision','record',1,'hash','fixture','connector','1','2026-07-12T00:00:00.000Z','[]','2026-07-12T00:00:00.000Z')`)
    expect(() => sqlite.exec(`insert into raw_source_occurrences (id,raw_record_id,raw_revision_id,connector_instance_id,connector_run_id,execution_scope_id,observed_at,received_at) values ('occurrence','record','revision','one','run-one','${two.executionScopeId}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z')`))
      .toThrow(/scope owner mismatch/)
    sqlite.exec(`insert into raw_source_occurrences (id,raw_record_id,raw_revision_id,connector_instance_id,connector_run_id,execution_scope_id,observed_at,received_at) values ('occurrence','record','revision','one','run-one','${one.executionScopeId}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z')`)
    expect(() => sqlite.exec(`update raw_source_occurrences set execution_scope_id='${two.executionScopeId}' where id='occurrence'`)).toThrow(/scope owner mismatch/)
    expect(() => sqlite.exec(`insert into retry_work (id,execution_scope_id,kind,connector_instance_id,filter_signature,checkpoint_schema_version,checkpoint_generation,reason,attempt,max_attempts,last_attempt_at,computed_delay_ms,next_attempt_at,horizon_at,state,owner_version,lineage_json,created_at,updated_at) values ('retry','${two.executionScopeId}','connector_capture','one','filters:{}','v1','1','server_failure',1,3,'2026-07-12T00:00:00.000Z',1000,'2026-07-12T00:00:01.000Z','2026-07-12T01:00:00.000Z','scheduled','1','{}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z')`))
      .toThrow(/scope owner mismatch/)
    sqlite.exec(`insert into retry_work (id,execution_scope_id,kind,connector_instance_id,filter_signature,checkpoint_schema_version,checkpoint_generation,reason,attempt,max_attempts,last_attempt_at,computed_delay_ms,next_attempt_at,horizon_at,state,owner_version,lineage_json,created_at,updated_at) values ('retry','${one.executionScopeId}','connector_capture','one','filters:{}','v1','1','server_failure',1,3,'2026-07-12T00:00:00.000Z',1000,'2026-07-12T00:00:01.000Z','2026-07-12T01:00:00.000Z','scheduled','1','{}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z')`)
    expect(() => sqlite.exec(`update retry_work set execution_scope_id='${two.executionScopeId}' where id='retry'`)).toThrow(/scope owner mismatch/)
    const normalization = `(id,execution_scope_id,kind,raw_revision_id,resolver_id,resolver_version,input_hash,reason,attempt,max_attempts,last_attempt_at,computed_delay_ms,next_attempt_at,horizon_at,state,owner_version,lineage_json,created_at,updated_at) values ('normalization','${one.executionScopeId}','normalization','revision','fixture','1','hash','server_failure',1,3,'2026-07-12T00:00:00.000Z',1000,'2026-07-12T00:00:01.000Z','2026-07-12T01:00:00.000Z','scheduled','1','{}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z')`
    sqlite.exec(`insert into retry_work ${normalization}`)
    expect(() => sqlite.exec(`update retry_work set lineage_json='{"connectorInstanceId":"missing"}' where id='normalization'`))
      .toThrow(/scope owner mismatch/)
    expect(() => sqlite.exec(`update retry_work set lineage_json='{"connectorInstanceId":"one","connectorRunId":"missing"}' where id='normalization'`))
      .toThrow(/scope owner mismatch/)
    expect(() => sqlite.exec(`insert into retry_work ${normalization.replace("'normalization'", "'missing-lineage'").replace("'{}'", "'{\"connectorInstanceId\":\"missing\"}'")}`))
      .toThrow(/scope owner mismatch/)
    expect(sqlite.prepare('pragma foreign_key_check').all()).toEqual([])
    sqlite.close()
  })
})
