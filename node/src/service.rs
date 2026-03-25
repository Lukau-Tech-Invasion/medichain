use medichain_runtime::{self, RuntimeApi};
use sc_executor::WasmExecutor;
use sc_service::{error::Error as ServiceError, Configuration, TaskManager};
use std::sync::Arc;

/// The Full Client type.
pub type FullClient = sc_service::TFullClient<
    medichain_runtime::Block,
    RuntimeApi,
    WasmExecutor<sp_io::SubstrateHostFunctions>,
>;

/// Build the node service.
pub fn new_full(config: Configuration) -> Result<TaskManager, ServiceError> {
    let sc_service::PartialComponents {
        client,
        backend,
        mut task_manager,
        import_queue,
        keystore_container,
        select_chain,
        transaction_pool,
        other: (block_import, grandpa_link, telemetry),
    } = new_partial(&config)?;

    let mut net_config = sc_network::config::FullNetworkConfiguration::new(&config.network);

    let (network, system_rpc_tx, tx_handler_controller, network_starter, sync_service) =
        sc_service::build_network(sc_service::BuildNetworkParams {
            config: &config,
            net_config,
            client: client.clone(),
            transaction_pool: transaction_pool.clone(),
            spawn_handle: task_manager.spawn_handle(),
            import_queue,
            block_announce_validator_builder: None,
            warp_sync_params: None,
            block_relay: None,
        })?;

    if config.offchain_worker.enabled {
        sc_service::build_offchain_workers(
            &config,
            task_manager.spawn_handle(),
            client.clone(),
            network.clone(),
        );
    }

    let role = config.role.clone();
    let force_authoring = config.force_authoring;
    let backoff_authoring_blocks: Option<()> = None;
    let name = config.network.node_name.clone();
    let enable_grandpa = !config.disable_grandpa;
    let prometheus_config = config.prometheus_config.clone();

    let rpc_extensions_builder = {
        let client = client.clone();
        let pool = transaction_pool.clone();

        Box::new(move |deny_rpc, _| {
            let deps = crate::rpc::FullDeps {
                client: client.clone(),
                pool: pool.clone(),
                deny_rpc,
            };

            crate::rpc::create_full(deps).map_err(Into::into)
        })
    };

    let _rpc_handlers = sc_service::spawn_tasks(sc_service::SpawnTasksParams {
        config,
        client: client.clone(),
        backend,
        task_manager: &mut task_manager,
        keystore: keystore_container.keystore(),
        transaction_pool: transaction_pool.clone(),
        rpc_builder: rpc_extensions_builder,
        network: network.clone(),
        system_rpc_tx,
        tx_handler_controller,
        sync_service: sync_service.clone(),
        telemetry: telemetry.as_mut(),
    })?;

    network_starter.start_network();
    Ok(task_manager)
}

pub fn new_partial(
    config: &Configuration,
) -> Result<
    sc_service::PartialComponents<
        FullClient,
        sc_service::TFullBackend<medichain_runtime::Block>,
        (),
        sc_consensus::DefaultSelectChain<sc_service::TFullBackend<medichain_runtime::Block>, medichain_runtime::Block>,
        sc_transaction_pool::FullPool<medichain_runtime::Block, FullClient>,
        (
            sc_consensus_aura::AuraBlockImport<
                medichain_runtime::Block,
                FullClient,
                sc_consensus_grandpa::BlockImport<
                    sc_service::TFullBackend<medichain_runtime::Block>,
                    medichain_runtime::Block,
                    FullClient,
                    sc_consensus::DefaultSelectChain<sc_service::TFullBackend<medichain_runtime::Block>, medichain_runtime::Block>,
                >,
                sp_consensus_aura::sr25519::AuthorityPair,
            >,
            sc_consensus_grandpa::LinkHalf<medichain_runtime::Block, FullClient, sc_consensus::DefaultSelectChain<sc_service::TFullBackend<medichain_runtime::Block>, medichain_runtime::Block>>,
            Option<sc_telemetry::Telemetry>,
        ),
    >,
    ServiceError,
> {
    let telemetry = config
        .telemetry_endpoints
        .clone()
        .filter(|x| !x.is_empty())
        .map(|endpoints| -> Result<_, sc_telemetry::Error> {
            let mut telemetry = sc_telemetry::Telemetry::new(16)?;
            let _handle = telemetry.handle().ok_or(sc_telemetry::Error::Handle)? ;
            Ok(telemetry)
        })
        .transpose()?;

    let executor = WasmExecutor::<sp_io::SubstrateHostFunctions>::builder()
        .with_execution_method(sc_executor::WasmExecutionMethod::Compiled)
        .build();

    let (client, backend, keystore_container, task_manager) =
        sc_service::new_full_parts::<medichain_runtime::Block, medichain_runtime::RuntimeApi, _>(
            config,
            telemetry.as_ref().map(|t| t.handle()),
            executor,
        )?;
    let client = Arc::new(client);

    let select_chain = sc_consensus::long_est_chain(backend.clone(), client.clone());

    let transaction_pool = sc_transaction_pool::BasicPool::new_full(
        config.transaction_pool.clone(),
        config.role.is_authority().into(),
        config.prometheus_config.as_ref(),
        task_manager.spawn_essential_handle(),
        client.clone(),
    );

    let (grandpa_block_import, grandpa_link) = sc_consensus_grandpa::block_import(
        client.clone(),
        &select_chain,
        telemetry.as_ref().map(|t| t.handle()),
    )?;

    let aura_block_import = sc_consensus_aura::AuraBlockImport::<_, _, _, sp_consensus_aura::sr25519::AuthorityPair>::new(
        grandpa_block_import.clone(),
        client.clone(),
    );

    let import_queue = sc_consensus_aura::import_queue::<sp_consensus_aura::sr25519::AuthorityPair, _, _, _, _, _>(
        sc_consensus_aura::ImportQueueParams {
            block_import: aura_block_import.clone(),
            justification_import: Some(Box::new(grandpa_block_import)),
            client: client.clone(),
            select_chain: select_chain.clone(),
            spawner: &task_manager.spawn_essential_handle(),
            registry: config.prometheus_registry(),
            check_for_equivocation: Default::default(),
            telemetry: telemetry.as_ref().map(|t| t.handle()),
            compatibility_mode: Default::default(),
        },
    ).map_err(|e| ServiceError::Application(Box::new(e)))?;

    Ok(sc_service::PartialComponents {
        client,
        backend,
        task_manager,
        import_queue,
        keystore_container,
        select_chain,
        transaction_pool,
        other: (aura_block_import, grandpa_link, telemetry),
    })
}
