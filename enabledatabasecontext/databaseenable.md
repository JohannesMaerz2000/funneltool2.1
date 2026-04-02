So first request, list of submissions, you can do:

pagination
size of page
filter by vin
filter by dates from and to with ISO dates
curl --location 'https://api-dev.release.seller.aampere.com/api/v1/submissions?page=1&pageSize=20&vin=dsfasdf&from=2026-01-01T00%3A00%3A00.000Z&to=2026-01-01T00%3A00%3A00.000Z' \
--header 'x-api-key: ft_akey_fa5a140ae49341695a1f739fd35931a4':two: Second request, get submission details by id:
curl --location 'https://api-dev.release.seller.aampere.com/api/v1/submissions/0231a273-2912-4011-84f4-d2b3218fb8b0' \
--header 'x-api-key: ft_akey_fa5a140ae49341695a1f739fd35931a4'