import logging
import json
import supabase
from postgrest.base_request_builder import CountMethod
from postgrest import APIResponse
from postgrest.base_request_builder import SingleAPIResponse
from typing import TypedDict

LeagueMap = TypedDict('LeagueMap', {'name': str, 'id': str})


class Supabase(supabase.Client):
    def __init__(self, url: str, key: str):
        super().__init__(supabase_url=url, supabase_key=key)

    async def fetch_divisions(self) -> list[LeagueMap]:
        """Fetch current leagues"""
        logging.info("Fetching divisions")
        r: APIResponse = (self.table('divisions')
                          .select("division_id", "division_name", count=CountMethod.exact)
                          .execute())
        logging.info(f'Recieved response:: {r}')
        if r.count <= 0:
            raise Exception("Error retrieving divisions")
        divisions = r.data
        return divisions

    async def fetch_teams(self, division_name: str) -> list[str]:
        """Fetch all teams from a given league"""
        logging.info(f"Fetching teams from {division_name}")
        r_div_id: SingleAPIResponse = (
            self.table("divisions")
            .select("division_id")
            .eq("division_name", division_name.upper())
            .limit(1)
            .single()
            .execute()
        )
        logging.debug(f"Recieved response:: {r_div_id}")
        division_id = r_div_id.data["division_id"]
        logging.debug(f"Fetched Division ID: {division_id}")
        r_teams: APIResponse = (
            self.table("teams")
            .select("team_name", count=CountMethod.exact)
            .eq("division_id", division_id)
            .execute()
        )
        logging.debug(f"Recieved response:: {r_teams}")
        if r_teams.count <= 0:
            raise Exception("Error retrieving teams")
        logging.debug(f"Fetched teams:: {r_teams.data}")
        teams = [team["team_name"] for team in r_teams.data]
        return teams

    async def fetch_series_id(self, teams: list[int]) -> int:
        """Fetch a series id if it exists, otherwise creates one and populates the table"""
        logging.info(f'Fetching or generating series id')
        r_series_id: SingleAPIResponse = (self.table('series')
                                          .select('*', count=CountMethod.exact)
                                          .contains('team_ids', list(map(str, teams)))
                                          .limit(1).maybe_single()
                                          .execute())
        logging.info(f'Recieved response:: {r_series_id}')
        if r_series_id is None:
            new_series_id_r: APIResponse = (self.table('series')
                                            .insert({"team_ids": list(map(str, teams))}, count=CountMethod.exact)
                                            .execute())
            logging.info(f'Recieved response: {new_series_id_r}')
            if new_series_id_r.count > 0:
                series_id = new_series_id_r.data[0]["series_id"]
                return series_id
        series_id = r_series_id.data["series_id"]
        return series_id

    async def fetch_like_team(self, team_name: str) -> int:
        logging.info(f'Fetching like team id')
        r_team_id: SingleAPIResponse = (self.table('teams')
                                        .select('team_id', count=CountMethod.exact)
                                        .ilike("team_name", team_name)
                                        .limit(1).single()
                                        .execute())
        if r_team_id.count <= 0:
            raise Exception(f'Could not find team {team_name}')
        team_id = r_team_id.data["team_id"]
        return team_id

    async def fetch_team_by_id(self, team_id: int) -> str:
        logging.info(f"Fetching team by id")
        r_team_name: SingleAPIResponse = (self.table('teams')
                                          .select("team_name", count=CountMethod.exact)
                                          .eq("team_id", team_id)
                                          .limit(1).single()
                                          .execute())
        if r_team_name.count <= 0:
            raise Exception(f'Could not find team id {id}')
        team_name = r_team_name.data["team_name"]
        return team_name

    async def fetch_division_by_id(self, div_id: int) -> str:
        logging.info(f"Fetching division by id")
        r_division_name: SingleAPIResponse = (self.table('divisions')
                                          .select("division_name", count=CountMethod.exact)
                                          .eq("division_id", div_id)
                                          .limit(1).single()
                                          .execute())
        if r_division_name.count <= 0:
            raise Exception(f'Could not find team id {id}')
        division_name = r_division_name.data["division_name"]
        return division_name
