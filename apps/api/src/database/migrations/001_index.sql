CREATE TABLE index_deployments (
  id text PRIMARY KEY,
  chain_id bigint NOT NULL,
  deployment_hash text NOT NULL,
  start_block bigint NOT NULL,
  last_block bigint NOT NULL,
  last_hash text NOT NULL DEFAULT ''
);

CREATE TABLE indexed_events (
  deployment_id text NOT NULL REFERENCES index_deployments(id) ON DELETE CASCADE,
  id text NOT NULL,
  name text NOT NULL,
  contract_address text NOT NULL,
  block_number bigint NOT NULL,
  transaction_hash text NOT NULL,
  log_index integer NOT NULL,
  timestamp bigint,
  args jsonb NOT NULL,
  PRIMARY KEY (deployment_id, id),
  UNIQUE (deployment_id, transaction_hash, log_index)
);

CREATE INDEX indexed_events_order ON indexed_events (deployment_id, block_number DESC, log_index DESC);
CREATE INDEX indexed_events_name ON indexed_events (deployment_id, name, block_number DESC, log_index DESC);

CREATE TABLE campaigns (
  deployment_id text NOT NULL REFERENCES index_deployments(id) ON DELETE CASCADE,
  campaign_id numeric(78, 0) NOT NULL,
  creator text NOT NULL,
  title text NOT NULL,
  goal numeric(78, 0) NOT NULL CHECK (goal > 0),
  raised numeric(78, 0) NOT NULL DEFAULT 0 CHECK (raised >= 0),
  deadline bigint NOT NULL,
  state smallint NOT NULL DEFAULT 0 CHECK (state BETWEEN 0 AND 3),
  PRIMARY KEY (deployment_id, campaign_id)
);

CREATE TABLE creators (
  deployment_id text NOT NULL REFERENCES index_deployments(id) ON DELETE CASCADE,
  address text NOT NULL,
  PRIMARY KEY (deployment_id, address)
);
