use openlogs_analysis::{Fight, load_fight_slice};
use openlogs_gamedata::{ChannelSpells, Curated, DungeonTable, SpellClasses};
use openlogs_index::{FightSummary, Indexer, LogIndex};
use openlogs_service::auras_dto::AuraKindDto;
use openlogs_service::log_dto::log_view;
use openlogs_service::meter_dto::MeterCategoryDto;
use openlogs_service::player_dto::MetricDto;
use openlogs_service::report_dto::{AttributionDto, FilterDto};
use openlogs_service::scope_dto::{DimensionDto, ScopeDto, ScopeMetricDto};
use openlogs_service::views_dto::{PageDto, ViewOptionsDto, WindowDto};
use serde::Deserialize;
use serde::de::DeserializeOwned;

/// Pulls kept loaded: the shown pull and the one it is compared with.
const LOADED_PULLS: usize = 2;

/// One open log: its index, the most recently loaded pulls and the game data reports use.
pub struct Engine {
    indexer: Indexer,
    index: LogIndex,
    /// Most recently loaded first; at most [`LOADED_PULLS`] entries.
    fights: Vec<(u32, Fight)>,
    curated: Curated,
    dungeons: Option<DungeonTable>,
    channels: ChannelSpells,
    spell_classes: SpellClasses,
}

impl Default for Engine {
    fn default() -> Self {
        Self {
            indexer: Indexer::new(),
            index: LogIndex::empty(),
            fights: Vec::new(),
            curated: Curated::bundled(),
            dungeons: None,
            channels: ChannelSpells::default(),
            spell_classes: SpellClasses::default(),
        }
    }
}

impl Engine {
    pub fn set_dungeons(&mut self, json: &str) -> Result<(), String> {
        self.dungeons = Some(DungeonTable::from_json(json).map_err(|err| err.to_string())?);
        Ok(())
    }

    pub fn set_channel_spells(&mut self, json: &str) -> Result<(), String> {
        self.channels = ChannelSpells::from_json(json).map_err(|err| err.to_string())?;
        Ok(())
    }

    pub fn set_spell_classes(&mut self, json: &str) -> Result<(), String> {
        self.spell_classes = SpellClasses::from_json(json).map_err(|err| err.to_string())?;
        Ok(())
    }

    /// Starts indexing a new log; the previous log and its pulls are dropped.
    pub fn begin_index(&mut self) {
        self.indexer = Indexer::new();
        self.index = LogIndex::empty();
        self.fights.clear();
    }

    pub fn index_feed(&mut self, chunk: &[u8]) {
        self.indexer.feed(chunk);
    }

    /// Finishes indexing and returns the pull list as JSON.
    pub fn finish_index(&mut self, log_id: &str, file_name: &str, size_bytes: u64) -> String {
        self.index = std::mem::take(&mut self.indexer).finish();
        self.view_json(log_id, file_name, size_bytes, false)
    }

    /// The index in the form [`Engine::restore_index`] reads back.
    pub fn index_json(&self) -> String {
        serde_json::to_string(&self.index).expect("the index serializes")
    }

    /// Opens a log from an index stored earlier, without reading the log again.
    pub fn restore_index(
        &mut self,
        index_json: &str,
        log_id: &str,
        file_name: &str,
        size_bytes: u64,
    ) -> Result<String, String> {
        let index: LogIndex = serde_json::from_str(index_json).map_err(|err| err.to_string())?;
        self.begin_index();
        self.index = index;
        Ok(self.view_json(log_id, file_name, size_bytes, true))
    }

    /// The byte range `[prelude, end)` the pull needs from the log.
    pub fn fight_range(&self, fight_index: u32) -> Result<(u64, u64), String> {
        let summary = self.summary(fight_index)?;
        Ok((summary.prelude_offset, summary.end_offset))
    }

    /// Marks a loaded pull as the most recently used one; `false` when it is not loaded.
    pub fn touch_fight(&mut self, fight_index: u32) -> bool {
        let Some(position) = self
            .fights
            .iter()
            .position(|(index, _)| *index == fight_index)
        else {
            return false;
        };
        let entry = self.fights.remove(position);
        self.fights.insert(0, entry);
        true
    }

    /// Loads a pull from its part of the log, which starts at byte `base_offset`.
    pub fn load_fight(
        &mut self,
        part: &[u8],
        base_offset: u64,
        fight_index: u32,
    ) -> Result<(), String> {
        let fight = load_fight_slice(part, base_offset, self.summary(fight_index)?);
        self.fights.retain(|(index, _)| *index != fight_index);
        self.fights.insert(0, (fight_index, fight));
        self.fights.truncate(LOADED_PULLS);
        Ok(())
    }

    /// Runs a report command on loaded pulls. Commands and arguments are the UI's API calls.
    pub fn call(&self, command: &str, args_json: &str) -> Result<String, String> {
        let curated = &self.curated;
        match command {
            "quick_overview" => {
                let args: OverviewArgs = parse(args_json)?;
                let fight = self.fight(args.fight_index)?;
                json(openlogs_service::quick_overview(
                    fight,
                    curated,
                    args.filter,
                ))
            }
            "damage_done_report" => {
                let args: FightArgs = parse(args_json)?;
                json(openlogs_service::damage_done(
                    self.fight(args.fight_index)?,
                    args.filter,
                ))
            }
            "healing_report" => {
                let args: FightArgs = parse(args_json)?;
                json(openlogs_service::healing(
                    self.fight(args.fight_index)?,
                    args.filter,
                ))
            }
            "damage_taken_report" => {
                let args: FightArgs = parse(args_json)?;
                json(openlogs_service::damage_taken(
                    self.fight(args.fight_index)?,
                    args.filter,
                ))
            }
            "breakdown_report" => {
                let args: BreakdownArgs = parse(args_json)?;
                json(openlogs_service::breakdown_report(
                    self.fight(args.fight_index)?,
                    curated,
                    args.filter,
                    args.scope,
                    args.metric,
                    args.group,
                ))
            }
            "filter_options" => {
                let args: OptionsArgs = parse(args_json)?;
                json(openlogs_service::filter_options(
                    self.fight(args.fight_index)?,
                    curated,
                    args.filter,
                    args.scope,
                    args.metric,
                    args.dimension,
                ))
            }
            "player_detail" => {
                let args: PlayerArgs = parse(args_json)?;
                json(openlogs_service::player_detail(
                    self.fight(args.fight_index)?,
                    curated,
                    args.player,
                    args.metric,
                    args.filter,
                    args.scope,
                )?)
            }
            "ability_detail" => {
                let args: AbilityArgs = parse(args_json)?;
                json(openlogs_service::ability_detail(
                    self.fight(args.fight_index)?,
                    curated,
                    args.player,
                    args.spell,
                    args.pet.as_deref(),
                    args.metric,
                    args.filter,
                    args.scope,
                )?)
            }
            "target_detail" => {
                let args: TargetArgs = parse(args_json)?;
                let fight = self.fight(args.fight_index)?;
                json(openlogs_service::target_detail(
                    fight,
                    args.name,
                    args.filter,
                    args.scope,
                )?)
            }
            "deaths_report" => {
                let args: ScopedArgs = parse(args_json)?;
                json(openlogs_service::deaths(
                    self.fight(args.fight_index)?,
                    curated,
                    args.filter,
                    args.scope,
                ))
            }
            "casts_report" => {
                let args: CastsArgs = parse(args_json)?;
                json(openlogs_service::casts(
                    self.fight(args.fight_index)?,
                    curated,
                    args.filter,
                    args.scope,
                    args.group,
                    args.hide_procs,
                ))
            }
            "auras_report" => {
                let args: AurasArgs = parse(args_json)?;
                json(openlogs_service::auras(
                    self.fight(args.fight_index)?,
                    args.filter,
                    args.scope,
                    args.kind,
                    args.group,
                ))
            }
            "interrupts_report" => {
                let args: GroupedArgs = parse(args_json)?;
                json(openlogs_service::interrupts(
                    self.fight(args.fight_index)?,
                    args.filter,
                    args.scope,
                    args.group,
                ))
            }
            "resources_report" => {
                let args: ScopedArgs = parse(args_json)?;
                json(openlogs_service::resources(
                    self.fight(args.fight_index)?,
                    args.filter,
                    args.scope,
                ))
            }
            "compare_pulls" => {
                let args: CompareArgs = parse(args_json)?;
                json(openlogs_service::compare_pulls(
                    curated,
                    (args.fight_a, self.fight(args.fight_a)?),
                    (args.fight_b, self.fight(args.fight_b)?),
                    args.attribution,
                    args.include_overkill,
                ))
            }
            "events" => {
                let args: EventsArgs = parse(args_json)?;
                json(openlogs_service::events(
                    self.fight(args.fight_index)?,
                    curated,
                    args.filter,
                    args.scope,
                    args.metric,
                    args.options,
                    args.page,
                ))
            }
            "timeline" => {
                let args: TimelineArgs = parse(args_json)?;
                json(openlogs_service::timeline(
                    self.fight(args.fight_index)?,
                    curated,
                    &self.channels,
                    args.filter,
                    args.scope,
                    args.metric,
                    args.lanes,
                    args.options,
                    args.window,
                ))
            }
            "replay_meter" => {
                let args: MeterArgs = parse(args_json)?;
                json(openlogs_service::replay_meter(
                    self.fight(args.fight_index)?,
                    args.filter,
                    args.category,
                    args.expand,
                ))
            }
            "replay" => {
                let args: ReplayArgs = parse(args_json)?;
                json(openlogs_service::replay(
                    self.fight(args.fight_index)?,
                    curated,
                    &self.channels,
                    &self.spell_classes,
                    self.index.advanced_logging,
                ))
            }
            _ => Err(format!("Unknown command {command}")),
        }
    }

    fn view_json(&self, log_id: &str, file_name: &str, size_bytes: u64, cache_hit: bool) -> String {
        let view = log_view(
            log_id,
            file_name,
            size_bytes,
            cache_hit,
            &self.index,
            self.dungeons.as_ref(),
        );
        serde_json::to_string(&view).expect("the pull list serializes")
    }

    fn summary(&self, fight_index: u32) -> Result<&FightSummary, String> {
        self.index
            .fights
            .iter()
            .find(|fight| fight.index == fight_index)
            .ok_or_else(|| format!("Pull {fight_index} does not exist in this log."))
    }

    fn fight(&self, fight_index: u32) -> Result<&Fight, String> {
        self.summary(fight_index)?;
        self.fights
            .iter()
            .find(|(index, _)| *index == fight_index)
            .map(|(_, fight)| fight)
            .ok_or_else(|| format!("Pull {fight_index} is not loaded."))
    }
}

fn parse<T: DeserializeOwned>(args_json: &str) -> Result<T, String> {
    serde_json::from_str(args_json).map_err(|err| format!("Invalid arguments: {err}"))
}

fn json<T: serde::Serialize>(value: T) -> Result<String, String> {
    serde_json::to_string(&value).map_err(|err| err.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReplayArgs {
    fight_index: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MeterArgs {
    fight_index: u32,
    filter: FilterDto,
    category: MeterCategoryDto,
    expand: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OverviewArgs {
    fight_index: u32,
    filter: Option<FilterDto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FightArgs {
    fight_index: u32,
    filter: FilterDto,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BreakdownArgs {
    fight_index: u32,
    filter: FilterDto,
    #[serde(default)]
    scope: ScopeDto,
    metric: ScopeMetricDto,
    group: DimensionDto,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptionsArgs {
    fight_index: u32,
    filter: FilterDto,
    #[serde(default)]
    scope: ScopeDto,
    metric: ScopeMetricDto,
    dimension: DimensionDto,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScopedArgs {
    fight_index: u32,
    filter: FilterDto,
    #[serde(default)]
    scope: ScopeDto,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroupedArgs {
    fight_index: u32,
    filter: FilterDto,
    #[serde(default)]
    scope: ScopeDto,
    group: DimensionDto,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CastsArgs {
    fight_index: u32,
    filter: FilterDto,
    #[serde(default)]
    scope: ScopeDto,
    group: DimensionDto,
    #[serde(default)]
    hide_procs: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlayerArgs {
    fight_index: u32,
    player: u32,
    metric: MetricDto,
    filter: FilterDto,
    #[serde(default)]
    scope: ScopeDto,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AbilityArgs {
    fight_index: u32,
    player: u32,
    spell: u32,
    pet: Option<String>,
    metric: MetricDto,
    filter: FilterDto,
    #[serde(default)]
    scope: ScopeDto,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TargetArgs {
    fight_index: u32,
    name: String,
    filter: FilterDto,
    #[serde(default)]
    scope: ScopeDto,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AurasArgs {
    fight_index: u32,
    filter: FilterDto,
    #[serde(default)]
    scope: ScopeDto,
    kind: AuraKindDto,
    group: DimensionDto,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompareArgs {
    fight_a: u32,
    fight_b: u32,
    attribution: AttributionDto,
    include_overkill: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventsArgs {
    fight_index: u32,
    filter: FilterDto,
    #[serde(default)]
    scope: ScopeDto,
    metric: ScopeMetricDto,
    #[serde(default)]
    options: ViewOptionsDto,
    page: PageDto,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TimelineArgs {
    fight_index: u32,
    filter: FilterDto,
    #[serde(default)]
    scope: ScopeDto,
    metric: ScopeMetricDto,
    lanes: DimensionDto,
    #[serde(default)]
    options: ViewOptionsDto,
    window: WindowDto,
}
